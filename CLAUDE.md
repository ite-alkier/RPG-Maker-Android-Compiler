# RPG Maker Android Compiler — Projekt-Kontext für Claude Code

Diese Datei fasst die Entwicklungshistorie und wichtige Architektur-
Entscheidungen zusammen, die in einer ausführlichen Chat-Session mit
Claude (Web/App) entstanden sind. Ziel: Claude Code soll ohne erneute
Erklärung direkt produktiv weiterarbeiten können.

## Was die Software macht

Ein Windows-Desktop-Tool (Electron), das aus einem RPG Maker MV/MZ
Web-Export per Klickstrecke eine installierbare, signierte Android-APK
erzeugt — ohne dass Endnutzer:innen Android Studio, Node.js oder sonstige
Entwicklungs-Vorkenntnisse brauchen. Marke: FrogSmith (Untermarke von
ITE-Alkier, Tony Alkier), Copyright Neocrypton.

## Architektur-Überblick

```
main.js                     Electron-Hauptprozess, IPC-Handler, Auto-Update, Menü
preload.js                  Sichere Bridge zwischen UI und Hauptprozess
index.html / renderer.js    Die UI (lädt Übersetzungen async über IPC)
src/i18n.js                 Liest lang/*.json automatisch ein (dynamischer Sprachlader)
src/projectDetector.js      Erkennung MV vs. MZ (sucht index.html, prüft rpg_core.js vs. rmmz_core.js)
src/projectImporter.js      Kopiert/normalisiert das Projekt nach www/
src/nativeAndroidScaffold.js  Kopiert & patcht das native Android-Projekt (Schritt 6)
src/setupWizard.js          Lädt JDK 17 + Android SDK herunter, dauerhaft im App-Datenordner
src/gradleBuild.js          Keystore-Erzeugung, local.properties, Gradle-Build-Aufruf
src/projectZipper.js        ZIP-Erstellung fürs Projekt-Backup
templates/native-android/   Natives Android-Projekt-Grundgerüst (siehe unten, WICHTIG)
lang/*.json                 Sprachdateien (de, en, fr — ja.json ggf. lokal ergänzt)
assets/flags/*.gif          Flaggen für den Sprachumschalter (18x12px, ISO-Ländercode.gif)
assets/icon.ico             App-Icon (MUSS mind. 256x256 enthalten, sonst schlägt der Build fehl)
```

## Die wichtigste Architektur-Entscheidung: Kein Capacitor

Frühere Versionen nutzten Capacitor (npm-basiert, `npx cap add android`).
**Das wurde komplett verworfen**, weil RPG-Maker-MV/MZ-Exporte darunter
beim Start dauerhaft im Lade-Spinner hängen blieben — lautlos, ohne
Fehlermeldung. Ursache: Capacitor bedient Web-Inhalte über eine virtuelle
`https://localhost`-Adresse (WebViewAssetLoader), nicht über das
klassische `file://`-Schema. RPG Maker MZ lädt Spieldaten per XHR/fetch,
und das blieb unter Capacitors Mechanismus hängen.

**Die Lösung**: `templates/native-android/` ist ein selbst gebautes,
schlankes natives Android-Projekt (Java, kein Kotlin), das über
`file:///android_asset/...` lädt, mit expliziten WebView-Einstellungen
(`allowFileAccess`, `allowFileAccessFromFileURLs`,
`allowUniversalAccessFromFileURLs`, `setDomStorageEnabled` für
Spielstände, `setMediaPlaybackRequiresUserGesture(false)`). Verifiziert
an echten Testgeräten (Pixel 7 Pro) mit echten RPG-Maker-MV/MZ-Projekten.

**Wichtiger Zusatz-Fix**: RPG Maker MV/MZ wartet auf eine erste
Nutzer-Eingabe (Audio-Unlock-Policy). `MainActivity.java` simuliert
automatisch einen Tipp an Position **(1,1)** (bewusst NICHT die
Bildschirmmitte — dort registrierte es bei Tests nicht, vermutlich wegen
WebView-Skalierungseffekten) über echte `MotionEvent`s (nicht nur
JavaScript-Events, da ein simples `new Event('touchstart')` kein
`changedTouches` hat und RPG Makers Touch-Handler damit abstürzt).
Zusätzlich werden `mousedown`/`mouseup`/`click`/`keydown`(Enter) Events
per JS auf `document` gefeuert (mehrere zeitversetzte Versuche: 700ms,
1500ms, 3000ms nach Seitenladen).

## RPG Maker MV Sonderfall: MadeWithMV Plugin

RPG Maker MV hat einen bekannten Deployment-Bug: Bei aktiviertem
"Exclude unused files" beim Bereitstellen wird `img/system/MadeWithMv.png`
fälschlich weggelassen, obwohl das MadeWithMV-Plugin es braucht. Die App
zeigt daher automatisch einen Hinweis-Dialog (`mvNotice.*` Keys), sobald
ein MV-Projekt erkannt wird, mit der Empfehlung, das Plugin zu
deaktivieren.

## Icon-Erzeugung (wichtige Falle)

`assets/icon.ico` MUSS ein Quellbild von mindestens 256x256 haben, BEVOR
es als ICO gespeichert wird. Pillow deckelt beim ICO-Export die
enthaltenen Größen sonst stillschweigend auf die Auflösung des
Ausgangsbildes — 128px/256px-Varianten werden dann einfach weggelassen
statt hochskaliert, was electron-builder mit
`"image ... must be at least 256x256"` quittiert. Immer erst auf 256x256
hochskalieren (`Image.resize`), DANN als ICO speichern.

## i18n-System (Sprachdateien)

- `lang/xx.json` — Dateiname (ohne Endung) = Sprachcode. Neue Sprache
  hinzufügen = neue Datei reinlegen, KEIN Code-Anfassen nötig.
- Jede Datei hat einen `"_flag"` Schlüssel ganz oben (z.B. `"_flag": "en"`),
  der bestimmt, welche `assets/flags/xx.gif` geladen wird. Sprachcode
  (ISO 639) und Ländercode für die Flagge (ISO 3166) sind NICHT immer
  identisch (z.B. Japanisch = Sprache "ja", Flagge "jp"). Der `_flag`-
  Wert lässt sich direkt in der jeweiligen Datei von Hand korrigieren.
- `src/i18n.js` liest den `lang/`-Ordner beim Start des Hauptprozesses
  synchron ein (`fs.readdirSync`).
- Renderer holt die komplette Sprachdaten-Bundle asynchron per IPC
  (`window.api.getLanguageBundle()`), da der Renderer keinen
  Dateisystemzugriff hat (contextIsolation).
- Sprachumschalter (`#langSwitch`) wird zur Laufzeit dynamisch aus den
  gefundenen Sprachen aufgebaut (keine festen Buttons mehr im HTML).
- Das native Anwendungsmenü (Datei/Bearbeiten/Ansicht/Fenster/Hilfe)
  wird bei jedem Sprachwechsel per `buildAppMenu(lang)` neu gebaut
  (Electrons rollenbasierte Menüs übernehmen sonst NICHT die
  In-App-Sprache, sondern die Systemsprache).
- Beim Hinzufügen neuer Übersetzungs-Keys: IMMER in allen vorhandenen
  `lang/*.json` Dateien ergänzen (aktuell de, en, fr — ja.json ggf.
  separat beim Nutzer, nicht zwangsläufig im lokalen Ordner vorhanden).

## Bekannte Stolperfallen (bereits gelöst, nicht erneut einbauen)

- **electron-builder + asar**: `"asar": false` ist bewusst gesetzt.
  Mit `asar: true` (Standard) schlägt das rekursive Kopieren von
  `templates/native-android` beim Nutzer mit `ENOENT: opendir` fehl,
  da `fs-extra`s `copy()` bestimmte Node-fs-Funktionen nutzt, die
  Electrons asar-Patching nicht abdeckt.
- **electron-builder + winCodeSign**: Symlink-Fehler beim Entpacken
  unter Windows ohne Entwicklermodus/Admin-Rechte. Workaround:
  `CSC_IDENTITY_AUTO_DISCOVERY=false` env var (im `dist`/`release`
  npm-Skript bereits gesetzt) UND/ODER Windows-Entwicklermodus aktiviert.
- **Protokoll-Spalte (`.log-column`) wuchs unkontrolliert mit vielen
  Log-Zeilen mit**: Ursache war fehlendes `min-height: 0` an
  verschachtelten Flex-/Grid-Containern (klassischer Flexbox-Bug: ohne
  das wird die Mindesthöhe am tatsächlichen, überlaufenden Inhalt
  bemessen statt am verfügbaren Platz). Fix: `min-height: 0` an
  `.log-column`, `.log-card`, `.main-column` + JavaScript
  (`syncLogColumnHeight()` in `renderer.js`) setzt die Höhe der
  Log-Spalte explizit als Pixelwert passend zur linken Spalte, per
  `ResizeObserver` aktuell gehalten.
- **Fenstergröße bei Windows-Skalierung >100%**: Fenstergröße wird beim
  Start anhand von `screen.getPrimaryDisplay().workAreaSize` berechnet
  (nicht mehr starr), damit bei 125%/150% Skalierung nichts abgeschnitten
  wird. `.layout` hat `overflow-y: auto`, wodurch bei zu wenig Platz
  automatisch ein (gestylter, schmaler) Scrollbalken ganz rechts im
  Fenster erscheint — ganz ohne expliziten Skalierungs-Check, ergibt
  sich rein aus der tatsächlich verfügbaren Höhe.
- **Package-ID darf sich nach Veröffentlichung nicht mehr ändern** (Play
  Store Regel) — UI warnt explizit davor (`step5.packageIdWarnTooltip`).
- **Keystore muss für alle Updates derselben App identisch bleiben** —
  wird einmalig pro Projekt erzeugt und liegt im Build-Ordner (wird
  beim "Projekt zippen" mitgesichert).

## Auto-Update (electron-updater)

Eingerichtet über GitHub Releases. `package.json` → `build.publish`
enthält Platzhalter `"DEIN-GITHUB-NAME"` / `"DEIN-REPO-NAME"`, die durch
die echten Werte ersetzt werden müssen. `npm run release` baut UND
veröffentlicht (braucht `GH_TOKEN` env var mit einem GitHub Personal
Access Token, Scope "repo"). `npm run dist` baut nur lokal, ohne
Veröffentlichung. Update-Prüfung läuft nur bei `app.isPackaged` (nicht
im `npm start` Entwicklungsmodus).

## Rechtliches / Branding

- "Über"-Dialog (Hilfe-Menü) zeigt Entwickler, Copyright, Support-Mail,
  Verfügbarkeits-Plattformen und einen Haftungsausschluss — alles über
  `about.*` i18n-Keys, mehrsprachig.
- Geplante Veröffentlichung: itch.io, rpgmaker.de, gamedevcafe.de,
  frogsmith.de.
- Aktuell in Testphase mit ausgewählten Testern, noch nicht öffentlich.

## Versionsstand

Aktuell v1.1.0. Weitere Änderungen sollten die Versionsnummer in
`package.json` entsprechend hochzählen (`versionCode` in generierten
Android-Projekten ist aktuell noch fest auf `1` gesetzt, kein
automatisches Hochzählen bei Updates — bekannte offene TODO).
