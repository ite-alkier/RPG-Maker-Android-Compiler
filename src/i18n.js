const fs = require('fs');
const path = require('path');

// Ordner mit den Sprachdateien -- jede Datei "xx.json" wird automatisch
// als Sprache "xx" eingelesen. Eine neue Sprache hinzuzufuegen bedeutet
// daher lediglich: eine neue Datei (z.B. "fr.json") in diesen Ordner
// legen, kein Code muss angepasst werden.
const LANG_DIR = path.join(__dirname, '..', 'lang');
const DEFAULT_LANG = 'de';

function loadTranslations() {
  const translations = {};
  let files = [];

  try {
    files = fs.readdirSync(LANG_DIR).filter((f) => f.toLowerCase().endsWith('.json'));
  } catch (err) {
    console.error('Sprachordner konnte nicht gelesen werden:', LANG_DIR, err);
    return translations;
  }

  for (const file of files) {
    const code = path.basename(file, '.json').toLowerCase();
    try {
      const raw = fs.readFileSync(path.join(LANG_DIR, file), 'utf-8');
      translations[code] = JSON.parse(raw);
    } catch (err) {
      console.error(`Sprachdatei "${file}" konnte nicht geladen werden:`, err);
    }
  }

  return translations;
}

// Wird einmalig beim ersten require() eingelesen (Hauptprozess-Start).
// Fuer die in dieser App ueblichen wenigen, kleinen JSON-Dateien ist ein
// synchrones Einlesen beim Start voellig unproblematisch.
const translations = loadTranslations();

/**
 * Liefert die Liste verfuegbarer Sprachen, jeweils mit einem aus dem
 * Dateinamen abgeleiteten Kuerzel (z.B. "de", "en", "fr") und einem
 * Anzeige-Label in Grossbuchstaben fuer Buttons/Menues (z.B. "DE").
 * Sortiert alphabetisch, aber "de" (Standardsprache) steht immer zuerst.
 */
function getAvailableLanguages() {
  const codes = Object.keys(translations);
  codes.sort((a, b) => {
    if (a === DEFAULT_LANG) return -1;
    if (b === DEFAULT_LANG) return 1;
    return a.localeCompare(b);
  });
  return codes.map((code) => ({ code, label: code.toUpperCase() }));
}

/**
 * Uebersetzt einen Schluessel in die angegebene Sprache. Fehlt die
 * Sprache komplett oder der Schluessel darin, wird auf die
 * Standardsprache zurueckgefallen, zuletzt auf den rohen Schluesselnamen
 * (damit im Zweifel wenigstens etwas Sinnvolles angezeigt wird statt
 * eines Absturzes).
 *
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 */
function t(lang, key, params) {
  const dict = translations[lang] || translations[DEFAULT_LANG] || {};
  const fallbackDict = translations[DEFAULT_LANG] || {};
  let str = dict[key] !== undefined ? dict[key] : fallbackDict[key] !== undefined ? fallbackDict[key] : key;

  if (params) {
    Object.keys(params).forEach((k) => {
      str = str.split(`{${k}}`).join(params[k]);
    });
  }
  return str;
}

module.exports = { translations, t, getAvailableLanguages, DEFAULT_LANG };
