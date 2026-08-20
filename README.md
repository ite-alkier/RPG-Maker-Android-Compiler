# RPG Maker Android Compiler

Ein Windows-Desktop-Tool (Electron), das aus einem RPG Maker MV/MZ Web-Export
per Klickstrecke eine installierbare, signierte Android-APK erzeugt — ohne
dass Endnutzer:innen Android Studio, Node.js oder sonstige Entwicklungs-
Vorkenntnisse brauchen.

## Funktionsumfang (aktueller Stand)

1. **Projekt auswählen** — Ordner oder ZIP eines RPG-Maker-Web-Exports
2. **Engine bestätigen** — automatische MV/MZ-Erkennung, manuell korrigierbar
3. **Projektname** festlegen
4. **Import** — normalisiert das Projekt in einen einheitlichen `www`-Ordner
5. **App-Einstellungen** — Package-ID, Versionsname, Bildschirmausrichtung, Icon
6. **Android-Projekt vorbereiten** — kopiert ein mitgeliefertes natives
   Android-Projekt-Grundgerüst und spielt Spieldaten + Einstellungen ein.
   **Läuft komplett lokal, ohne Internetverbindung.**
7. **Ausgabeordner für die APK** wählen
8. **Android-Projekt sichern** (optional) — Backup als ZIP, inkl. Keystore
9. **APK erstellen** — lädt beim allerersten Mal automatisch JDK 17 und
   Android SDK herunter (dauerhaft, kein erneuter Download bei künftigen
   Builds), erzeugt einen Signierungs-Keystore, kompiliert mit Gradle zur
   fertigen, signierten APK

Zweisprachige Oberfläche (Deutsch/Englisch), Live-Protokoll für alle
Hintergrundvorgänge.

## Setup (Entwicklung)

```bash
npm install
npm start
```

## Architektur

```
main.js                     Electron-Hauptprozess, IPC-Handler
preload.js                  Sichere Bridge zwischen UI und Hauptprozess
index.html / renderer.js    Die UI
src/i18n.js                 Übersetzungstabelle (DE/EN), von Renderer UND
                             Hauptprozess genutzt
src/projectDetector.js      Erkennung MV vs. MZ
src/projectImporter.js      Kopiert/normalisiert das Projekt nach www/
src/nativeAndroidScaffold.js  Kopiert & patcht das native Android-Projekt
                             (Schritt 6)
src/setupWizard.js          Lädt JDK 17 + Android SDK herunter, dauerhaft
                             im App-Datenordner, nur fehlende Teile werden
                             (nach)installiert
src/gradleBuild.js          Keystore-Erzeugung, local.properties, Gradle-
                             Build-Aufruf, APK-Lokalisierung
src/projectZipper.js        ZIP-Erstellung fürs Projekt-Backup (Schritt 8)
templates/native-android/   Das native Android-Projekt-Grundgerüst, das
                             pro Spiel kopiert und individualisiert wird
```

## Warum ein natives Android-Template statt Capacitor?

Frühere Versionen dieses Tools nutzten Capacitor (npm-basiert, `npx cap add
android`). Dabei trat ein reproduzierbares Problem auf: RPG-Maker-MV/MZ-
Exporte blieben beim Start dauerhaft im Lade-Spinner hängen — ohne jede
Fehlermeldung, weder in der App-Konsole noch im System-Log. Nach
ausführlicher Diagnose (Logcat, Chrome-Remote-Debugging, Vergleich mit
einem bekannt funktionierenden nativen WebView-Ansatz) stellte sich heraus:

- Capacitor bedient Web-Inhalte über eine virtuelle `https://localhost`-
  Adresse (`WebViewAssetLoader`), nicht über das klassische `file://`-Schema.
- RPG Maker MZ lädt Spieldaten (JSON, Bilder) per `XMLHttpRequest`/`fetch`.
  Unter Capacitors Mechanismus blieben diese Anfragen bei unseren Tests
  lautlos hängen.
- Ein direkter `file:///android_asset/...`-Ansatz mit den Berechtigungen
  `allowFileAccess`, `allowFileAccessFromFileURLs` und
  `allowUniversalAccessFromFileURLs` funktionierte dagegen nachweislich —
  bestätigt an einem realen Testgerät (Pixel 7 Pro) mit einem echten
  RPG-Maker-MZ-Projekt.

Das jetzige `templates/native-android/` folgt daher bewusst diesem
einfacheren, nachweislich funktionierenden Muster: ein schlankes natives
Android-Projekt (Java, keine Kotlin-Abhängigkeit) mit einer einzigen
`MainActivity.java`, die das Spiel per `file://` mit den richtigen
WebView-Einstellungen lädt — inklusive `DomStorage` (für Spielstände, die
RPG Maker MV/MZ über `localStorage` sichert) und
`setMediaPlaybackRequiresUserGesture(false)` (gegen mögliche Audio-
Blockaden). Als angenehmer Nebeneffekt braucht Schritt 6 dadurch kein
`npm install`/`npx cap` mehr und läuft dadurch praktisch augenblicklich,
komplett offline.

## Bekannte Einschränkungen

- **Icon-Skalierung**: Das gewählte Icon wird unverändert in alle
  `mipmap-*`-Auflösungsordner kopiert, nicht auf die jeweils passende
  Auflösung herunterskaliert. Optisch nicht perfekt, funktional aber
  einwandfrei (Android skaliert beim Anzeigen automatisch). Für later:
  echte Multi-Resolution-Skalierung ergänzen.
- **`versionCode`** ist aktuell fest auf `1` gesetzt (kein automatisches
  Hochzählen bei App-Updates).
- **Touch-Steuerung**: Die native `MainActivity.java` selbst fügt keine
  eigene Touch-Logik hinzu — RPG Maker MZ bringt bereits eigene
  Touch-/Pointer-Behandlung mit, die im WebView normal funktioniert. Für
  RPG Maker MV können ggf. zusätzliche Touch-Plugins nötig sein (MV ist
  ursprünglich nicht touch-first designt).
- Die Command-line-Tools-Download-URL für den Setup-Wizard wird zur
  Laufzeit von `developer.android.com/studio` ausgelesen (da Google dafür
  keine dauerhafte URL anbietet). Schlägt das fehl, greift ein fest
  hinterlegter Rückfallwert, der mit der Zeit veralten kann.

## Nächste sinnvolle Ausbauschritte

1. Echte Icon-Skalierung (z.B. mit einer reinen JS-Bildverarbeitung ohne
   native Kompilierungsschritte, um erneute `npm install`-Probleme wie mit
   nativen Postinstall-Skripten zu vermeiden)
2. `versionCode` automatisch hochzählen
3. Windows-Installer/portable `.exe` bauen und testen (`electron-builder`
   ist vorbereitet, `npm run dist`)
4. Setup-Wizard/Werkzeug-Installation mit sichtbarem Fortschrittsbalken
   statt nur Log-Prozentzahlen
