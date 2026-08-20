const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs-extra');
const extractZip = require('extract-zip');

const { detectProject } = require('./src/projectDetector');
const { importProject } = require('./src/projectImporter');
const { prepareNativeAndroidProject, patchVersionInfo, patchSigningPlaceholders } = require('./src/nativeAndroidScaffold');
const { zipDirectory } = require('./src/projectZipper');
const { t, getAvailableLanguages, translations } = require('./src/i18n');

// Rueckfall-Zuordnung Sprachcode (ISO 639) -> Laendercode fuer die
// Flaggen-Datei (ISO 3166), falls eine Sprachdatei (noch) keinen
// eigenen "_flag"-Schluessel gesetzt hat. Der "_flag"-Schluessel in der
// jeweiligen lang/xx.json Datei hat immer Vorrang und laesst sich dort
// im Zweifel schnell von Hand korrigieren, ohne den Code anzufassen.
const LANGUAGE_FLAG_OVERRIDES = {
  ja: 'jp',
  ko: 'kr',
  zh: 'cn',
  ar: 'sa',
  he: 'il',
  hi: 'in',
  vi: 'vn',
  cs: 'cz',
  da: 'dk',
  el: 'gr',
  sv: 'se',
  uk: 'ua',
};

/**
 * Sucht die passende Flaggen-Datei fuer eine Sprache im
 * assets/flags/-Ordner. Prioritaet: 1) expliziter "_flag"-Schluessel in
 * der jeweiligen Sprachdatei, 2) bekannte Sprache->Land Zuordnung,
 * 3) der Sprachcode selbst. Gibt null zurueck, wenn nichts gefunden
 * wird -- der Renderer faellt in dem Fall auf den reinen Sprachcode als
 * Button-Text zurueck (kein kaputtes Bild).
 *
 * @param {string} langCode
 * @param {object} [langTranslations] das translations[langCode] Objekt
 * @returns {string|null}
 */
function resolveFlagPath(langCode, langTranslations) {
  const flagsDir = path.join(__dirname, 'assets', 'flags');
  const explicitFlag = langTranslations && langTranslations['_flag'];
  const candidates = [explicitFlag, LANGUAGE_FLAG_OVERRIDES[langCode], langCode].filter(Boolean);

  for (const candidate of candidates) {
    const filePath = path.join(flagsDir, `${candidate}.gif`);
    if (fs.existsSync(filePath)) {
      return `assets/flags/${candidate}.gif`;
    }
  }
  return null;
}
const { getToolsDir, ensureToolsInstalled } = require('./src/setupWizard');
const {
  ensureKeystore,
  ensureLocalProperties,
  runGradleAssembleRelease,
  locateReleaseApk,
} = require('./src/gradleBuild');

let mainWindow;
let currentAppLang = 'de';

// Behebt GPU-Prozess-Abstürze (z.B. "GPU process launch failed"), die auf
// bestimmten Systemen auftreten (u.a. bei Netzlaufwerken, VMs, Remote-
// Desktop-Sitzungen oder bestimmten Treiber-Kombinationen). Die App
// benötigt keine GPU-Beschleunigung, daher ist das Deaktivieren sicher.
app.disableHardwareAcceleration();

// Arbeitsverzeichnis der App im Nutzerprofil, hier landen entpackte
// ZIPs und das spaeter normalisierte Projekt (Grundstein fuer den
// naechsten Schritt: Android-Projekt-Erstellung).
function getWorkDir() {
  return path.join(app.getPath('userData'), 'work');
}

function showAboutDialog(lang) {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: t(lang, 'about.title'),
    message: t(lang, 'about.message'),
    detail: t(lang, 'about.detail', { version: app.getVersion() }),
    buttons: ['OK'],
    defaultId: 0,
    noLink: true,
  });
}

// Eigenes Anwendungsmenue, das die Standard-Menues (Datei/Bearbeiten/
// Ansicht/Fenster) beibehaelt, aber im Hilfe-Menue einen eigenen
// "Ueber..."-Eintrag ergaenzt. Wird bei jedem Sprachwechsel neu gebaut,
// damit der Eintrag selbst zweisprachig ist.
function buildAppMenu(lang) {
  // Komplett eigenes Menue statt Electrons rollenbasierten Standard-
  // Menues (fileMenu/editMenu/viewMenu/windowMenu) -- deren Beschriftung
  // folgt sonst der Betriebssystemsprache und NICHT der in der App
  // gewaehlten Sprache. Die Funktionalitaet der einzelnen Eintraege
  // bleibt ueber "role" erhalten, nur die sichtbare Beschriftung kommt
  // jetzt aus unserer eigenen Uebersetzungstabelle.
  const template = [
    {
      label: t(lang, 'menu.file'),
      submenu: [{ role: 'quit', label: t(lang, 'menu.exit') }],
    },
    {
      label: t(lang, 'menu.edit'),
      submenu: [
        { role: 'undo', label: t(lang, 'menu.undo') },
        { role: 'redo', label: t(lang, 'menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t(lang, 'menu.cut') },
        { role: 'copy', label: t(lang, 'menu.copy') },
        { role: 'paste', label: t(lang, 'menu.paste') },
        { role: 'delete', label: t(lang, 'menu.delete') },
        { type: 'separator' },
        { role: 'selectAll', label: t(lang, 'menu.selectAll') },
      ],
    },
    {
      label: t(lang, 'menu.view'),
      submenu: [
        { role: 'reload', label: t(lang, 'menu.reload') },
        { role: 'forceReload', label: t(lang, 'menu.forceReload') },
        { role: 'toggleDevTools', label: t(lang, 'menu.toggleDevTools') },
        { type: 'separator' },
        { role: 'resetZoom', label: t(lang, 'menu.resetZoom') },
        { role: 'zoomIn', label: t(lang, 'menu.zoomIn') },
        { role: 'zoomOut', label: t(lang, 'menu.zoomOut') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t(lang, 'menu.toggleFullscreen') },
      ],
    },
    {
      label: t(lang, 'menu.window'),
      submenu: [
        { role: 'minimize', label: t(lang, 'menu.minimize') },
        { role: 'close', label: t(lang, 'menu.close') },
      ],
    },
    {
      label: t(lang, 'menu.help'),
      submenu: [
        {
          label: t(lang, 'about.menuLabel'),
          click: () => showAboutDialog(lang),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  // Fenstergroesse an den tatsaechlich verfuegbaren Platz anpassen, statt
  // stur eine feste Groesse zu erzwingen. Wichtig bei Windows-Skalierung
  // >100% (z.B. Notebooks mit 125%/150%): der effektiv nutzbare Bereich
  // schrumpft dann rechnerisch (z.B. 1920x1080 bei 125% -> nur noch
  // ca. 1536x864 "wirksame" Pixel), wodurch eine fest eingestellte
  // Fenstergroesse leicht abgeschnitten werden kann.
  const preferredWidth = 1480;
  const preferredHeight = 1020;
  const minWidth = 900;
  const minHeight = 560;
  const margin = 40; // etwas Sicherheitsabstand zu Taskleiste/Fensterrand

  const { width: workWidth, height: workHeight } = screen.getPrimaryDisplay().workAreaSize;

  const windowWidth = Math.max(minWidth, Math.min(preferredWidth, workWidth - margin));
  const windowHeight = Math.max(minHeight, Math.min(preferredHeight, workHeight - margin));

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth,
    minHeight,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');
}

// ---------------------------------------------------------------------
// Automatische Updates ueber GitHub Releases (electron-updater). Prueft
// beim Start im Hintergrund auf eine neuere Version, laedt sie bei
// Bedarf herunter und fragt danach, ob jetzt neu gestartet werden soll.
// Testern muss dafuer NICHT jedes Mal manuell eine neue Installations-
// datei zugeschickt werden -- einmal "npm run release" auf GitHub
// veroeffentlicht, reicht.
// ---------------------------------------------------------------------
function setupAutoUpdater() {
  // Nur bei der installierten Version pruefen -- im Entwicklungsmodus
  // (npm start) gibt es keine echte veroeffentlichte Version zum
  // Vergleichen, das wuerde nur unnoetige Fehlermeldungen erzeugen.
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('error', (err) => {
    console.error('Auto-Update-Fehler:', err);
  });

  autoUpdater.on('update-downloaded', (info) => {
    const lang = currentAppLang;
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: t(lang, 'update.downloaded.title'),
        message: t(lang, 'update.downloaded.message', { version: info.version }),
        buttons: [t(lang, 'update.downloaded.restartNow'), t(lang, 'update.downloaded.later')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Update-Prüfung fehlgeschlagen:', err);
  });
}

app.whenReady().then(() => {
  buildAppMenu(currentAppLang);
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Schritt 1: Nutzer waehlt ZIP-Datei ODER Ordner aus.
 * Bei ZIP wird zunaechst entpackt. Anschliessend wird das Projekt
 * automatisch analysiert (MV/MZ-Erkennung + Content-Root).
 */
ipcMain.handle('project:select', async (event, { sourceType, lang } = {}) => {
  const isZipMode = sourceType === 'zip';
  const currentLang = lang || 'de';

  const dialogOptions = {
    title: isZipMode
      ? t(currentLang, 'step1.logOpenZip')
      : t(currentLang, 'step1.logOpenFolder'),
    properties: isZipMode ? ['openFile'] : ['openDirectory'],
  };
  if (isZipMode) {
    dialogOptions.filters = [{ name: 'ZIP-Archiv', extensions: ['zip'] }];
  }

  const result = await dialog.showOpenDialog(mainWindow, dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const selectedPath = result.filePaths[0];
  const workDir = getWorkDir();
  await fs.ensureDir(workDir);

  let rootDir;

  const stat = await fs.stat(selectedPath);
  if (stat.isDirectory()) {
    rootDir = selectedPath;
  } else {
    // ZIP entpacken in einen frischen Unterordner des Arbeitsverzeichnisses
    const extractDir = path.join(workDir, 'extracted_' + Date.now());
    await fs.ensureDir(extractDir);
    await extractZip(selectedPath, { dir: extractDir });
    rootDir = extractDir;
  }

  const detection = detectProject(rootDir);

  return {
    canceled: false,
    selectedPath,
    rootDir,
    detection,
  };
});

/**
 * Schritt 2: Nutzer bestaetigt/korrigiert die erkannte Engine und
 * bestaetigt den Content-Root. Das Projekt wird in einen einheitlichen
 * www-Ordner normalisiert -- die Basis fuer den spaeteren
 * Android-Projekt + Gradle-Build (naechster Ausbauschritt).
 */
ipcMain.handle('project:import', async (event, { contentRoot, engine, projectName }) => {
  if (!contentRoot || !engine) {
    throw new Error('contentRoot und engine muessen angegeben werden.');
  }

  const safeName = (projectName || 'projekt')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'projekt';

  const targetWwwDir = path.join(getWorkDir(), 'builds', safeName, 'www');

  const stats = await importProject(contentRoot, targetWwwDir);

  return {
    targetWwwDir,
    engine,
    ...stats,
  };
});

ipcMain.handle('app:getWorkDir', async () => getWorkDir());

ipcMain.handle('app:getLanguageBundle', async () => ({
  languages: getAvailableLanguages().map((lang) => ({
    ...lang,
    flag: resolveFlagPath(lang.code, translations[lang.code]),
  })),
  translations,
  defaultLang: 'de',
}));

ipcMain.on('app:setLanguage', (event, lang) => {
  currentAppLang = lang || 'de';
  buildAppMenu(currentAppLang);
});

ipcMain.handle('app:showMvNotice', async (event, { lang } = {}) => {
  const currentLang = lang || 'de';
  await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: t(currentLang, 'mvNotice.title'),
    message: t(currentLang, 'mvNotice.title'),
    detail: t(currentLang, 'mvNotice.message'),
    buttons: ['OK'],
    defaultId: 0,
    noLink: true,
  });
  return { acknowledged: true };
});

ipcMain.handle('project:selectIcon', async (event, { lang } = {}) => {
  const currentLang = lang || 'de';
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t(currentLang, 'step5.iconButton'),
    properties: ['openFile'],
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { canceled: false, iconPath: result.filePaths[0] };
});

/**
 * Schritt 6: Aus dem importierten www-Ordner ein natives Android-Projekt
 * erzeugen (aus mitgelieferter Vorlage, siehe src/nativeAndroidScaffold.js):
 * Template kopieren, Spieldaten einspielen, Package-ID/Mindest-Android-
 * Version/Versionsdaten/App-Name/Icon/Orientation setzen. Laeuft komplett
 * lokal, ohne Internetverbindung. Der Fortschritt wird live per
 * 'build:log' Events an die UI gestreamt.
 *
 * @param {{ targetWwwDir: string, appId: string, appName: string,
 *           versionName: string, orientation: string, iconPath: string|null }} payload
 */
ipcMain.handle('project:prepareCapacitor', async (event, payload) => {
  const { targetWwwDir, appId, appName, versionName, orientation, iconPath, minSdkVersion, lang } = payload;

  if (!targetWwwDir) {
    throw new Error('targetWwwDir fehlt. Bitte zuerst das Projekt importieren.');
  }

  // buildDir ist der Elternordner von www/
  const buildDir = path.dirname(targetWwwDir);

  const onLog = (line, stream) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('build:log', { line, stream });
    }
  };

  await prepareNativeAndroidProject(
    buildDir,
    { appId, appName, versionName, orientation, iconPath, minSdkVersion, versionCode: 1, lang },
    onLog
  );

  return { buildDir };
});

ipcMain.handle('project:selectApkOutputDir', async (event, { lang } = {}) => {
  const currentLang = lang || 'de';
  const result = await dialog.showOpenDialog(mainWindow, {
    title: t(currentLang, 'step7.button'),
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  return { canceled: false, outputDir: result.filePaths[0] };
});

ipcMain.handle('project:zipAndroidProject', async (event, { buildDir, lang } = {}) => {
  const currentLang = lang || 'de';

  if (!buildDir) {
    throw new Error(t(currentLang, 'step8.logNoProject'));
  }

  const defaultName = `${path.basename(buildDir)}-android-projekt.zip`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: t(currentLang, 'step8.zipButton'),
    defaultPath: defaultName,
    filters: [{ name: 'ZIP-Archiv', extensions: ['zip'] }],
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  // Gradle-Build-/Cache-Ordner ausschliessen -- die sind gross und werden
  // beim naechsten Gradle-Build automatisch neu erzeugt.
  await zipDirectory(buildDir, result.filePath, [
    'android/.gradle',
    'android/.idea',
    'android/app/build',
    'android/build',
  ]);

  return { canceled: false, savedPath: result.filePath };
});

/**
 * Schritt 9: kompiliert das vorbereitete Android-Projekt mit Gradle zu
 * einer fertigen, signierten APK. Orchestriert: verwaltete Werkzeuge
 * sicherstellen (JDK + Android-SDK, einmalig herunterladen und danach
 * dauerhaft wiederverwenden), Keystore (erzeugen/wiederverwenden),
 * Signing- & Versions-Patch, local.properties, Gradle-Build, Ergebnis
 * kopieren, optional Aufraeumen.
 */
ipcMain.handle('project:buildApk', async (event, payload) => {
  const { buildDir, appName, versionName, outputDir, cleanupAfterBuild, lang } = payload;
  const currentLang = lang || 'de';

  const onLog = (line, stream) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('build:log', { line, stream });
    }
  };
  const say = (key, params, stream) => onLog(t(currentLang, key, params), stream || 'info');

  if (!buildDir) {
    throw new Error(t(currentLang, 'step9.logNoAndroidProject'));
  }

  const androidDir = path.join(buildDir, 'android');

  say('step9.logCheckingPrereqs');
  const toolsDir = getToolsDir(app);
  const { jdkHome, sdkRoot } = await ensureToolsInstalled(toolsDir, onLog);
  say('step9.logPrereqsOk', null, 'ok');

  say('step9.logLocalProperties');
  await ensureLocalProperties(androidDir, sdkRoot);

  const keystoreDir = path.join(buildDir, 'keystore');
  const keystoreAlreadyExisted = await fs.pathExists(path.join(keystoreDir, 'release.keystore'));
  if (keystoreAlreadyExisted) {
    say('step9.logKeystoreExisting');
  } else {
    say('step9.logKeystoreCreating');
  }
  const keystoreInfo = await ensureKeystore(buildDir, appName, jdkHome, onLog);
  if (!keystoreAlreadyExisted) {
    say('step9.logKeystoreCreated', null, 'ok');
  }

  say('step9.logPatchingGradle');
  await patchSigningPlaceholders(androidDir, keystoreInfo);
  await patchVersionInfo(androidDir, { versionName: versionName || '1.0.0', versionCode: 1 });

  say('step9.logBuildStart');
  await runGradleAssembleRelease(androidDir, jdkHome, sdkRoot, onLog);
  say('step9.logBuildDone', null, 'ok');

  const apkPath = await locateReleaseApk(androidDir);
  if (!apkPath) {
    const msg = t(currentLang, 'step9.logApkNotFound');
    onLog(msg, 'stderr');
    throw new Error(msg);
  }

  say('step9.logCopyingApk');
  const finalOutputDir = outputDir || path.join(buildDir, 'apk-output');
  await fs.ensureDir(finalOutputDir);
  const safeAppName = (appName || 'app').replace(/[^a-zA-Z0-9-_]+/g, '-');
  const finalApkName = `${safeAppName}-${versionName || '1.0.0'}.apk`;
  const finalApkPath = path.join(finalOutputDir, finalApkName);
  await fs.copy(apkPath, finalApkPath, { overwrite: true });
  say('step9.logApkReady', { path: finalApkPath }, 'ok');

  if (cleanupAfterBuild) {
    say('step9.logBackingUpKeystore');
    const keystoreBackupDir = path.join(finalOutputDir, `${safeAppName}-keystore-backup`);
    await fs.copy(keystoreDir, keystoreBackupDir, { overwrite: true });

    say('step9.logCleaningUp');
    await fs.remove(buildDir);
    say('step9.logCleanupDone', null, 'ok');
  }

  return { apkPath: finalApkPath, outputDir: finalOutputDir };
});
