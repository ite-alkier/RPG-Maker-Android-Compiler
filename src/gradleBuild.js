const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Erzeugt ein zufaelliges, alphanumerisches Passwort (bewusst ohne
 * Sonderzeichen, damit es beim Weiterreichen an keytool/Gradle als
 * Kommandozeilen-Argument keine Escaping-Probleme geben kann).
 */
function generatePassword(length = 24) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += PASSWORD_CHARSET[bytes[i] % PASSWORD_CHARSET.length];
  }
  return result;
}

/**
 * Fuehrt einen Befehl aus und streamt jede Ausgabezeile per onLog.
 * (Analoges Gegenstueck zu runCommand in capacitorScaffold.js)
 *
 * @param {object} [envOverride] wird mit process.env zusammengefuehrt,
 *   damit z.B. JAVA_HOME/PATH gezielt auf unsere verwalteten Werkzeuge
 *   zeigen koennen, unabhaengig davon, was systemweit installiert ist.
 * @param {boolean} [useShell=true] .bat-Dateien (gradlew.bat,
 *   sdkmanager.bat) BRAUCHEN eine Shell zum Ausfuehren. Echte .exe-Dateien
 *   (z.B. keytool.exe) sollten dagegen OHNE Shell aufgerufen werden: bei
 *   shell:true werden Argumente mit Leerzeichen/Kommas (z.B. ein
 *   "-dname CN=X, OU=Y, ...") auf Windows nicht automatisch korrekt in
 *   Anfuehrungszeichen gesetzt und faelschlich in mehrere Argumente
 *   zerlegt. Ohne Shell reicht Node die Argumente unveraendert durch.
 */
function runCommand(command, args, cwd, onLog, envOverride, useShell = true) {
  return new Promise((resolve, reject) => {
    const env = envOverride ? { ...process.env, ...envOverride } : process.env;
    const child = spawn(command, args, { cwd, shell: useShell, env });

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

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${command} ${args.join(' ')}" endete mit Exit-Code ${code}`));
    });
  });
}

/**
 * Erzeugt (falls noch nicht vorhanden) einen Release-Keystore samt
 * Zugangsdaten-Datei im Build-Ordner. Der Keystore MUSS fuer alle
 * zukuenftigen Updates derselben App identisch bleiben, daher wird er
 * dauerhaft neben dem Android-Projekt abgelegt (und landet automatisch
 * mit im "Projekt zippen"-Backup, da er im buildDir liegt).
 *
 * @param {string} buildDir
 * @param {string} appName
 * @param {string} jdkHome Pfad zum verwalteten JDK (enthaelt bin/keytool.exe)
 * @param {(line: string, stream: string) => void} onLog
 * @returns {Promise<{keystorePath: string, storePassword: string, keyPassword: string, alias: string, infoPath: string}>}
 */
async function ensureKeystore(buildDir, appName, jdkHome, onLog) {
  const keystoreDir = path.join(buildDir, 'keystore');
  const keystorePath = path.join(keystoreDir, 'release.keystore');
  const infoPath = path.join(keystoreDir, 'keystore-info.json');

  if (await fs.pathExists(keystorePath) && (await fs.pathExists(infoPath))) {
    const info = await fs.readJson(infoPath);
    return { keystorePath, ...info, infoPath };
  }

  await fs.ensureDir(keystoreDir);

  const alias = 'release';
  const storePassword = generatePassword();
  const keyPassword = storePassword; // ein Passwort fuer beides, weniger Fehlerquellen

  const safeAppName = (appName || 'App').replace(/["\\]/g, '');
  const dname = `CN=${safeAppName}, OU=RPGMakerAndroidCompiler, O=RPGMakerAndroidCompiler, L=NA, S=NA, C=DE`;

  const keytoolCmd = path.join(jdkHome, 'bin', 'keytool.exe');

  await runCommand(
    keytoolCmd,
    [
      '-genkeypair',
      '-v',
      '-keystore',
      keystorePath,
      '-alias',
      alias,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-storepass',
      storePassword,
      '-keypass',
      keyPassword,
      '-dname',
      dname,
    ],
    keystoreDir,
    onLog,
    undefined,
    false // keytool.exe ist eine echte .exe -- ohne Shell aufrufen, damit
          // Argumente mit Leerzeichen/Kommas (der -dname Wert) korrekt
          // als EIN Argument ankommen statt von der Shell zerlegt zu werden
  );

  const info = { storePassword, keyPassword, alias };
  await fs.writeJson(infoPath, info, { spaces: 2 });

  return { keystorePath, ...info, infoPath };
}

/**
 * Stellt sicher, dass android/local.properties auf unsere verwaltete
 * Android-SDK-Installation zeigt. Ohne diese Datei bricht Gradle mit
 * "SDK location not found" ab. Wird bei jedem Build-Durchlauf
 * (ueber)geschrieben, damit sie garantiert korrekt ist.
 *
 * @param {string} androidDir
 * @param {string} androidSdkPath
 */
async function ensureLocalProperties(androidDir, androidSdkPath) {
  const localPropsPath = path.join(androidDir, 'local.properties');
  const gradleSafePath = androidSdkPath.replace(/\\/g, '\\\\');
  await fs.writeFile(localPropsPath, `sdk.dir=${gradleSafePath}\n`, 'utf-8');
}

/**
 * Fuehrt "gradlew.bat assembleRelease" im android-Ordner aus, mit
 * JAVA_HOME/ANDROID_HOME explizit auf unsere verwalteten, dauerhaft
 * installierten Werkzeuge gesetzt (unabhaengig von systemweiten
 * Umgebungsvariablen).
 *
 * @param {string} androidDir
 * @param {string} jdkHome
 * @param {string} sdkRoot
 * @param {(line: string, stream: string) => void} onLog
 */
async function runGradleAssembleRelease(androidDir, jdkHome, sdkRoot, onLog) {
  const env = {
    JAVA_HOME: jdkHome,
    ANDROID_HOME: sdkRoot,
    ANDROID_SDK_ROOT: sdkRoot,
    PATH: `${path.join(jdkHome, 'bin')};${process.env.PATH}`,
  };
  await runCommand('gradlew.bat', ['assembleRelease'], androidDir, onLog, env);
}

/**
 * Sucht die vom Gradle-Build erzeugte, signierte Release-APK am
 * Standard-Ausgabepfad.
 *
 * @param {string} androidDir
 * @returns {Promise<string|null>}
 */
async function locateReleaseApk(androidDir) {
  const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
  return (await fs.pathExists(apkPath)) ? apkPath : null;
}

module.exports = {
  generatePassword,
  runCommand,
  ensureKeystore,
  ensureLocalProperties,
  runGradleAssembleRelease,
  locateReleaseApk,
};
