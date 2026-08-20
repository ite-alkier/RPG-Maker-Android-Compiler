const fs = require('fs');
const path = require('path');

/**
 * Sucht rekursiv (begrenzte Tiefe) nach index.html Dateien innerhalb
 * eines Projektordners. RPG Maker MV exportiert die Web-Version meist
 * in einen zusaetzlichen "www" Unterordner, RPG Maker MZ legt
 * index.html direkt in den Projekt-Root. Damit der Import unabhaengig
 * davon funktioniert, ob der Nutzer den ZIP-Export, den Projektordner
 * oder direkt den "www"-Ordner auswaehlt, wird der ganze Baum
 * durchsucht.
 *
 * @param {string} rootDir
 * @param {number} maxDepth
 * @returns {string[]} absolute Pfade zu Ordnern, die eine index.html enthalten
 */
function findIndexHtmlDirs(rootDir, maxDepth = 4) {
  const results = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }

    const hasIndexHtml = entries.some(
      (e) => e.isFile() && e.name.toLowerCase() === 'index.html'
    );
    if (hasIndexHtml) {
      results.push(dir);
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // typische irrelevante/teure Ordner ueberspringen
      if (['node_modules', '.git', '__MACOSX'].includes(entry.name)) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  }

  walk(rootDir, 0);
  return results;
}

/**
 * Prueft anhand charakteristischer js-Dateien, ob es sich um ein
 * RPG Maker MV oder MZ Projekt handelt.
 *
 * @param {string} contentDir Ordner, der die index.html enthaelt
 * @returns {'MV'|'MZ'|null}
 */
function detectEngineForDir(contentDir) {
  const jsDir = path.join(contentDir, 'js');
  if (!fs.existsSync(jsDir)) return null;

  const mvCoreFile = path.join(jsDir, 'rpg_core.js');
  const mzCoreFile = path.join(jsDir, 'rmmz_core.js');

  if (fs.existsSync(mzCoreFile)) return 'MZ';
  if (fs.existsSync(mvCoreFile)) return 'MV';
  return null;
}

/**
 * Versucht, den Anzeigenamen des Spiels aus der index.html (<title>)
 * zu lesen. Dient nur als Vorschlag fuer das App-Name-Feld in der UI.
 *
 * @param {string} contentDir
 * @returns {string|null}
 */
function readProjectTitle(contentDir) {
  const indexPath = path.join(contentDir, 'index.html');
  try {
    const html = fs.readFileSync(indexPath, 'utf-8');
    const match = html.match(/<title>(.*?)<\/title>/i);
    if (match && match[1].trim().length > 0) {
      return match[1].trim();
    }
  } catch (err) {
    // ignorieren, Titel ist optional
  }
  return null;
}

/**
 * Hauptfunktion: analysiert einen importierten Ordner (entpacktes ZIP
 * oder direkt ausgewaehlter Ordner) und liefert einen Erkennungs-Vorschlag.
 *
 * @param {string} rootDir
 * @returns {{
 *   engine: 'MV'|'MZ'|null,
 *   contentRoot: string|null,
 *   projectTitle: string|null,
 *   candidates: Array<{dir: string, engine: 'MV'|'MZ'|null}>
 * }}
 */
function detectProject(rootDir) {
  const indexDirs = findIndexHtmlDirs(rootDir);

  const candidates = indexDirs.map((dir) => ({
    dir,
    engine: detectEngineForDir(dir),
  }));

  // Bevorzugt einen Kandidaten, bei dem die Engine eindeutig erkannt wurde.
  const best = candidates.find((c) => c.engine !== null) || candidates[0] || null;

  if (!best) {
    return {
      engine: null,
      contentRoot: null,
      projectTitle: null,
      candidates: [],
    };
  }

  return {
    engine: best.engine,
    contentRoot: best.dir,
    projectTitle: readProjectTitle(best.dir),
    candidates,
  };
}

module.exports = {
  detectProject,
  findIndexHtmlDirs,
  detectEngineForDir,
  readProjectTitle,
};
