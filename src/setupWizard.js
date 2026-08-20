const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const extractZip = require('extract-zip');

// Adoptium bietet eine dauerhaft aktuelle "latest"-API-URL -- kein
// Versionsstand, der veralten kann.
const JDK_DOWNLOAD_URL =
  'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk';

// Google bietet fuer die Platform-Tools ebenfalls eine dauerhaft aktuelle URL.
const PLATFORM_TOOLS_URL =
  'https://dl.google.com/android/repository/platform-tools-latest-windows.zip';

// Fuer die Command-line-Tools selbst gibt es KEINE dauerhafte URL (der
// Dateiname enthaelt immer eine Versionsnummer). Die aktuelle URL wird
// daher zur Laufzeit von der offiziellen Android-Entwicklerseite
// ausgelesen (resolveCmdlineToolsUrl). Dieser Wert ist nur der
// allerletzte Rueckfallwert, falls das Auslesen fehlschlaegt, und kann
// mit der Zeit veralten.
const CMDLINE_TOOLS_FALLBACK_URL =
  'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip';

const ANDROID_BUILD_TOOLS_PKG = 'build-tools;34.0.0';
const ANDROID_PLATFORM_PKG = 'platforms;android-34';
const ANDROID_BUILD_TOOLS_VERSION = '34.0.0';
const ANDROID_PLATFORM_VERSION = 'android-34';

function getToolsDir(app) {
  return path.join(app.getPath('userData'), 'tools');
}

// ---------------------------------------------------------------------
// HTTP-Hilfsfunktionen (Redirects folgen Node's https-Modul nicht
// automatisch, daher hier manuell nachgebaut)
// ---------------------------------------------------------------------

function httpGetText(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Zu viele Weiterleitungen.'));
    https
      .get(
        url,
        { headers: { 'User-Agent': 'rpgmaker-android-compiler', 'Accept-Encoding': 'identity' } },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            httpGetText(res.headers.location, redirectCount + 1).then(resolve, reject);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode} bei ${url}`));
            return;
          }
          let data = '';
          res.setEncoding('utf-8');
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        }
      )
      .on('error', reject);
  });
}

function downloadFile(url, destPath, onProgress, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Zu viele Weiterleitungen beim Download.'));
    https
      .get(url, { headers: { 'User-Agent': 'rpgmaker-android-compiler' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          downloadFile(res.headers.location, destPath, onProgress, redirectCount + 1).then(
            resolve,
            reject
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download fehlgeschlagen (HTTP ${res.statusCode}): ${url}`));
          return;
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let downloaded = 0;
        let lastPercent = -10;
        const file = fs.createWriteStream(destPath);

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (onProgress && total > 0) {
            const percent = Math.floor((downloaded / total) * 100);
            if (percent >= lastPercent + 10) {
              lastPercent = percent;
              onProgress(percent);
            }
          }
        });

        res.pipe(file);
        file.on('finish', () => file.close(() => resolve()));
        file.on('error', reject);
      })
      .on('error', reject);
  });
}

/**
 * Liest die aktuell gueltige Download-URL der Android Command-line-Tools
 * (Windows) direkt von der offiziellen Android-Entwicklerseite aus, damit
 * hier kein fest einprogrammierter, potenziell veralteter Versionsstand
 * verwendet werden muss. Faellt bei jedem Fehler auf einen Rueckfallwert
 * zurueck.
 *
 * @param {(line: string, stream: string) => void} onLog
 * @returns {Promise<string>}
 */
async function resolveCmdlineToolsUrl(onLog) {
  try {
    const html = await httpGetText('https://developer.android.com/studio');
    const match = html.match(
      /https:\/\/dl\.google\.com\/android\/repository\/commandlinetools-win-\d+_latest\.zip/
    );
    if (match) return match[0];
    throw new Error('Kein Treffer beim Auslesen der aktuellen Download-URL.');
  } catch (err) {
    onLog(
      `Konnte aktuelle Command-line-Tools-URL nicht automatisch ermitteln (${err.message}), verwende Rückfallversion.`,
      'stderr'
    );
    return CMDLINE_TOOLS_FALLBACK_URL;
  }
}

// ---------------------------------------------------------------------
// JDK
// ---------------------------------------------------------------------

async function findJdkHome(extractedRoot) {
  if (!(await fs.pathExists(extractedRoot))) return null;

  const directJava = path.join(extractedRoot, 'bin', 'java.exe');
  if (await fs.pathExists(directJava)) return extractedRoot;

  const entries = await fs.readdir(extractedRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const javaExe = path.join(extractedRoot, entry.name, 'bin', 'java.exe');
    if (await fs.pathExists(javaExe)) {
      return path.join(extractedRoot, entry.name);
    }
  }
  return null;
}

/**
 * Stellt sicher, dass ein JDK 17 dauerhaft im Tools-Ordner vorhanden ist.
 * Ist bereits eines vorhanden, wird es unveraendert weiterverwendet
 * (kein erneuter Download, kein Loeschen bei Nichtgebrauch).
 *
 * @param {string} toolsDir
 * @param {(line: string, stream: string) => void} onLog
 * @returns {Promise<string>} Pfad zum JDK-Home (enthaelt bin/java.exe)
 */
async function installJdk(toolsDir, onLog) {
  const jdkParentDir = path.join(toolsDir, 'jdk-17');

  const existingHome = await findJdkHome(jdkParentDir);
  if (existingHome) return existingHome;

  await fs.ensureDir(toolsDir);
  const zipPath = path.join(toolsDir, 'jdk-17-download.zip');

  onLog('Lade JDK 17 herunter (ca. 190 MB) …', 'info');
  await downloadFile(JDK_DOWNLOAD_URL, zipPath, (p) => onLog(`JDK-Download: ${p}%`, 'info'));

  onLog('Entpacke JDK …', 'info');
  await fs.remove(jdkParentDir);
  await fs.ensureDir(jdkParentDir);
  await extractZip(zipPath, { dir: jdkParentDir });
  await fs.remove(zipPath);

  const jdkHome = await findJdkHome(jdkParentDir);
  if (!jdkHome) {
    throw new Error('JDK wurde heruntergeladen, aber java.exe konnte darin nicht gefunden werden.');
  }
  return jdkHome;
}

// ---------------------------------------------------------------------
// Android SDK
// ---------------------------------------------------------------------

async function installPlatformTools(sdkRoot, onLog) {
  const marker = path.join(sdkRoot, 'platform-tools', 'adb.exe');
  if (await fs.pathExists(marker)) return;

  await fs.ensureDir(sdkRoot);
  const zipPath = path.join(sdkRoot, 'platform-tools-download.zip');

  onLog('Lade Android Platform-Tools herunter …', 'info');
  await downloadFile(PLATFORM_TOOLS_URL, zipPath, (p) => onLog(`Platform-Tools-Download: ${p}%`, 'info'));

  onLog('Entpacke Platform-Tools …', 'info');
  await fs.remove(path.join(sdkRoot, 'platform-tools'));
  await extractZip(zipPath, { dir: sdkRoot }); // Zip enthaelt bereits den Ordner "platform-tools"
  await fs.remove(zipPath);
}

async function findSdkManager(sdkRoot) {
  const candidate = path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat');
  return (await fs.pathExists(candidate)) ? candidate : null;
}

async function installAndroidCmdlineTools(sdkRoot, downloadUrl, onLog) {
  const existing = await findSdkManager(sdkRoot);
  if (existing) return existing;

  await fs.ensureDir(sdkRoot);
  const zipPath = path.join(sdkRoot, 'cmdline-tools-download.zip');

  onLog('Lade Android SDK Command-line Tools herunter …', 'info');
  await downloadFile(downloadUrl, zipPath, (p) => onLog(`SDK-Tools-Download: ${p}%`, 'info'));

  const tempExtractDir = path.join(sdkRoot, '_cmdline-tools-extract-temp');
  await fs.remove(tempExtractDir);
  onLog('Entpacke Command-line Tools …', 'info');
  await extractZip(zipPath, { dir: tempExtractDir });
  await fs.remove(zipPath);

  // Das Google-Zip enthaelt einen Ordner "cmdline-tools" direkt im Root.
  // sdkmanager erwartet ihn unter <sdkRoot>/cmdline-tools/latest/.
  const targetDir = path.join(sdkRoot, 'cmdline-tools', 'latest');
  await fs.ensureDir(path.join(sdkRoot, 'cmdline-tools'));
  await fs.remove(targetDir);
  await fs.move(path.join(tempExtractDir, 'cmdline-tools'), targetDir, { overwrite: true });
  await fs.remove(tempExtractDir);

  const sdkManagerPath = await findSdkManager(sdkRoot);
  if (!sdkManagerPath) {
    throw new Error('Android SDK Command-line Tools konnten nicht korrekt eingerichtet werden.');
  }
  return sdkManagerPath;
}

function runManagedCommand(command, args, cwd, env, onLog, stdinInput) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: true, env: { ...process.env, ...env } });

    if (stdinInput) {
      child.stdin.write(stdinInput);
      child.stdin.end();
    }

    child.stdout.on('data', (data) => {
      String(data)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => onLog(line, 'stdout'));
    });
    child.stderr.on('data', (data) => {
      String(data)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => onLog(line, 'stderr'));
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${command} ${args.join(' ')}" endete mit Exit-Code ${code}`));
    });
  });
}

async function installBuildToolsAndPlatform(sdkManagerPath, jdkHome, sdkRoot, onLog) {
  const env = { JAVA_HOME: jdkHome, PATH: `${path.join(jdkHome, 'bin')};${process.env.PATH}` };

  onLog('Akzeptiere Android-SDK-Lizenzen …', 'info');
  await runManagedCommand(
    sdkManagerPath,
    [`--sdk_root=${sdkRoot}`, '--licenses'],
    sdkRoot,
    env,
    onLog,
    'y\n'.repeat(20)
  );

  onLog('Installiere Build-Tools und Android-Plattform …', 'info');
  await runManagedCommand(
    sdkManagerPath,
    [`--sdk_root=${sdkRoot}`, ANDROID_BUILD_TOOLS_PKG, ANDROID_PLATFORM_PKG],
    sdkRoot,
    env,
    onLog
  );
}

/**
 * Prueft, welche verwalteten Werkzeuge bereits vorhanden sind.
 *
 * @param {string} toolsDir
 */
async function checkManagedTools(toolsDir) {
  const jdkParentDir = path.join(toolsDir, 'jdk-17');
  const jdkHome = await findJdkHome(jdkParentDir);

  const sdkRoot = path.join(toolsDir, 'android-sdk');
  const platformToolsOk = await fs.pathExists(path.join(sdkRoot, 'platform-tools', 'adb.exe'));
  const buildToolsOk = await fs.pathExists(
    path.join(sdkRoot, 'build-tools', ANDROID_BUILD_TOOLS_VERSION, 'aapt.exe')
  );
  const platformOk = await fs.pathExists(
    path.join(sdkRoot, 'platforms', ANDROID_PLATFORM_VERSION, 'android.jar')
  );

  return {
    jdkHome,
    jdkOk: Boolean(jdkHome),
    sdkRoot,
    platformToolsOk,
    buildToolsOk,
    platformOk,
    androidSdkOk: platformToolsOk && buildToolsOk && platformOk,
  };
}

/**
 * Stellt sicher, dass JDK + Android-SDK (Platform-Tools, Build-Tools,
 * Plattform) dauerhaft vorhanden sind. Bereits installierte Bestandteile
 * werden erkannt und NICHT erneut heruntergeladen -- nur fehlende Teile
 * werden nachinstalliert. Alles landet dauerhaft im App-Datenordner
 * (nicht im temporaeren Projekt-Build-Ordner) und bleibt daher auch nach
 * einem "Projekt aufraeumen" erhalten.
 *
 * @param {string} toolsDir
 * @param {(line: string, stream: string) => void} onLog
 * @returns {Promise<{jdkHome: string, sdkRoot: string}>}
 */
async function ensureToolsInstalled(toolsDir, onLog) {
  const status = await checkManagedTools(toolsDir);

  let jdkHome = status.jdkHome;
  if (!status.jdkOk) {
    onLog('JDK wird eingerichtet (einmalig) …', 'info');
    jdkHome = await installJdk(toolsDir, onLog);
    onLog('JDK bereit.', 'info');
  } else {
    onLog('JDK bereits vorhanden, wird weiterverwendet.', 'info');
  }

  const sdkRoot = status.sdkRoot;

  if (!status.platformToolsOk) {
    await installPlatformTools(sdkRoot, onLog);
  }

  if (!status.buildToolsOk || !status.platformOk) {
    onLog('Android SDK Build-Tools/Plattform werden eingerichtet (einmalig, mehrere hundert MB) …', 'info');
    const cmdlineToolsUrl = await resolveCmdlineToolsUrl(onLog);
    const sdkManagerPath = await installAndroidCmdlineTools(sdkRoot, cmdlineToolsUrl, onLog);
    await installBuildToolsAndPlatform(sdkManagerPath, jdkHome, sdkRoot, onLog);
    onLog('Android SDK bereit.', 'info');
  } else {
    onLog('Android SDK Build-Tools/Plattform bereits vorhanden, werden weiterverwendet.', 'info');
  }

  return { jdkHome, sdkRoot };
}

module.exports = {
  getToolsDir,
  checkManagedTools,
  ensureToolsInstalled,
  findJdkHome,
};
