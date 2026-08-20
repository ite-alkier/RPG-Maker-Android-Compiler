const fs = require('fs-extra');
const path = require('path');
const { t } = require('./i18n');

const MIPMAP_DIRS = ['mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];

function getTemplateDir() {
  // src/nativeAndroidScaffold.js -> ../templates/native-android
  return path.join(__dirname, '..', 'templates', 'native-android');
}

/**
 * Kopiert das gesamte native Android-Projekt-Grundgeruest (inkl. Gradle-
 * Wrapper, MainActivity.java, Standard-Icon) frisch in den Build-Ordner.
 * Ueberschreibt einen evtl. vorhandenen android-Ordner komplett, damit
 * immer ein sauberer, konsistenter Ausgangszustand vorliegt.
 */
async function copyTemplate(androidDir) {
  const templateDir = getTemplateDir();
  await fs.emptyDir(androidDir);
  await fs.copy(templateDir, androidDir, { overwrite: true });
}

/**
 * Kopiert den importierten Spiel-Ordner (www/) in den assets/www Ordner
 * des nativen Android-Projekts, von wo aus MainActivity.java ihn per
 * file:///android_asset/www/index.html laedt.
 */
async function copyWwwToAssets(wwwDir, androidDir) {
  const assetsWwwDir = path.join(androidDir, 'app', 'src', 'main', 'assets', 'www');
  await fs.emptyDir(assetsWwwDir);
  await fs.copy(wwwDir, assetsWwwDir, { overwrite: true });
}

/**
 * Traegt Package-ID, Mindest-Android-Version und Versionsdaten in
 * app/build.gradle ein. Ersetzt die dafuer vorgesehenen Platzhalterwerte
 * per einfachem Text-Austausch -- da wir das Template selbst kontrollieren
 * und dessen genauen Ausgangszustand kennen, ist das deutlich robuster
 * als ein Regex-Rateversuch gegen fremdgenerierten Code.
 *
 * @param {string} androidDir
 * @param {{appId: string, minSdkVersion: number|string, versionName: string, versionCode: number}} config
 */
async function patchAppIdentity(androidDir, config) {
  const gradlePath = path.join(androidDir, 'app', 'build.gradle');
  let content = await fs.readFile(gradlePath, 'utf-8');

  content = content.replace(
    'applicationId "com.rpgmaker.placeholder"',
    `applicationId "${config.appId}"`
  );
  content = content.replace(/minSdk \d+/, `minSdk ${config.minSdkVersion}`);
  content = content.replace(/versionCode \d+/, `versionCode ${config.versionCode}`);
  content = content.replace(/versionName "[^"]*"/, `versionName "${config.versionName}"`);

  await fs.writeFile(gradlePath, content, 'utf-8');
}

/**
 * Setzt ausschliesslich versionName/versionCode (nicht Package-ID oder
 * Mindest-Android-Version). Sicher erneut aufrufbar (z.B. in Schritt 9,
 * falls sich der Versionsname seit Schritt 6 geaendert hat), da hier
 * -- anders als bei der Package-ID -- Regex-basiert statt per fixem
 * Platzhalter-Text ersetzt wird.
 *
 * @param {string} androidDir
 * @param {{versionName: string, versionCode: number}} config
 */
async function patchVersionInfo(androidDir, config) {
  const gradlePath = path.join(androidDir, 'app', 'build.gradle');
  let content = await fs.readFile(gradlePath, 'utf-8');

  content = content.replace(/versionCode \d+/, `versionCode ${config.versionCode}`);
  content = content.replace(/versionName "[^"]*"/, `versionName "${config.versionName}"`);

  await fs.writeFile(gradlePath, content, 'utf-8');
}

/**
 * Traegt die Keystore-Zugangsdaten in die bereits im Template vorhandene
 * signingConfigs-Sektion von app/build.gradle ein (Platzhalter-Austausch).
 *
 * @param {string} androidDir
 * @param {{keystorePath: string, storePassword: string, keyPassword: string}} keystoreInfo
 */
async function patchSigningPlaceholders(androidDir, keystoreInfo) {
  const gradlePath = path.join(androidDir, 'app', 'build.gradle');
  let content = await fs.readFile(gradlePath, 'utf-8');

  const gradleSafeKeystorePath = keystoreInfo.keystorePath.replace(/\\/g, '/');

  content = content.replace(
    'storeFile file("PLACEHOLDER_KEYSTORE_PATH")',
    `storeFile file("${gradleSafeKeystorePath}")`
  );
  content = content.replace(
    'storePassword "PLACEHOLDER_STORE_PASSWORD"',
    `storePassword "${keystoreInfo.storePassword}"`
  );
  content = content.replace(
    'keyPassword "PLACEHOLDER_KEY_PASSWORD"',
    `keyPassword "${keystoreInfo.keyPassword}"`
  );

  await fs.writeFile(gradlePath, content, 'utf-8');
}

/**
 * Setzt die Bildschirmausrichtung in der AndroidManifest.xml.
 *
 * @param {string} androidDir
 * @param {'portrait'|'landscape'|'unspecified'} orientation
 */
async function patchManifestOrientation(androidDir, orientation) {
  const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
  let content = await fs.readFile(manifestPath, 'utf-8');
  content = content.replace(
    /android:screenOrientation="[^"]*"/,
    `android:screenOrientation="${orientation || 'unspecified'}"`
  );
  await fs.writeFile(manifestPath, content, 'utf-8');
}

/**
 * Traegt den App-Namen in strings.xml ein (XML-Sonderzeichen escaped).
 *
 * @param {string} androidDir
 * @param {string} appName
 */
async function patchAppName(androidDir, appName) {
  const stringsPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  let content = await fs.readFile(stringsPath, 'utf-8');

  const escaped = (appName || 'App')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Anfuehrungszeichen/Apostrophe brauchen in XML-TEXTinhalten (anders als
  // in Attributwerten) kein Escaping.

  content = content.replace('PLACEHOLDER_APP_NAME', escaped);
  await fs.writeFile(stringsPath, content, 'utf-8');
}

/**
 * Kopiert das vom Nutzer gewaehlte Icon in alle mipmap-* Aufloesungs-
 * Ordner (ersetzt dort jeweils das mitgelieferte Standard-Icon). Es wird
 * bewusst NICHT auf die jeweils passende Aufloesung herunterskaliert
 * (dafuer waere eine zusaetzliche Bildbearbeitungs-Abhaengigkeit noetig)
 * -- Android skaliert ein zu grosses Icon beim Anzeigen automatisch,
 * das Ergebnis ist optisch nicht perfekt optimiert, aber funktional
 * einwandfrei.
 *
 * @param {string} androidDir
 * @param {string|null} iconPath
 */
async function copyIcon(androidDir, iconPath) {
  if (!iconPath) return; // Standard-Icon aus dem Template bleibt bestehen

  for (const dir of MIPMAP_DIRS) {
    const targetPath = path.join(androidDir, 'app', 'src', 'main', 'res', dir, 'ic_launcher.png');
    await fs.copy(iconPath, targetPath, { overwrite: true });
  }
}

/**
 * Kompletter Ablauf fuer Schritt 6 ("Android-Projekt vorbereiten"):
 * Template kopieren, Spieldaten einspielen, App-Identitaet (Package-ID,
 * Mindest-Android-Version, Versionsname), App-Name, Icon und Orientation
 * setzen. Braucht anders als beim frueheren Capacitor-Ansatz KEINE
 * Internetverbindung und KEIN npm/Node -- alles sind lokale Datei-
 * Operationen, daher deutlich schneller und robuster.
 *
 * @param {string} buildDir Ordner, der www/ enthaelt
 * @param {object} config { appId, appName, versionName, orientation, iconPath, minSdkVersion }
 * @param {(line: string, stream: string) => void} onLog
 * @returns {Promise<{androidDir: string}>}
 */
async function prepareNativeAndroidProject(buildDir, config, onLog) {
  const lang = config.lang || 'de';
  const androidDir = path.join(buildDir, 'android');
  const wwwDir = path.join(buildDir, 'www');

  onLog(t(lang, 'step6.logCopyingTemplate'), 'info');
  await copyTemplate(androidDir);

  onLog(t(lang, 'step6.logCopyingGameData'), 'info');
  await copyWwwToAssets(wwwDir, androidDir);

  onLog(t(lang, 'step6.logSettingIdentity'), 'info');
  await patchAppIdentity(androidDir, {
    appId: config.appId,
    minSdkVersion: config.minSdkVersion || 30,
    versionName: config.versionName || '1.0.0',
    versionCode: config.versionCode || 1,
  });

  onLog(t(lang, 'step6.logSettingAppName'), 'info');
  await patchAppName(androidDir, config.appName);

  if (config.iconPath) {
    onLog(t(lang, 'step6.logCopyIcon'), 'info');
    await copyIcon(androidDir, config.iconPath);
  }

  onLog(t(lang, 'step6.logOrientation', { orientation: config.orientation }), 'info');
  await patchManifestOrientation(androidDir, config.orientation);

  onLog(t(lang, 'step6.logDone'), 'done');

  return { androidDir };
}

module.exports = {
  getTemplateDir,
  copyTemplate,
  copyWwwToAssets,
  patchAppIdentity,
  patchVersionInfo,
  patchSigningPlaceholders,
  patchManifestOrientation,
  patchAppName,
  copyIcon,
  prepareNativeAndroidProject,
};
