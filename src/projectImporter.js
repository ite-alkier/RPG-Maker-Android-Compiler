const fs = require('fs-extra');
const path = require('path');

// Dateien, die aus dem NW.js-Export stammen und fuer die Android/WebView
// Bereitstellung nicht benoetigt bzw. nicht relevant sind.
const EXCLUDED_FILES = new Set(['package.json']);

/**
 * Kopiert den erkannten Content-Root (das Verzeichnis, in dem die
 * index.html liegt) 1:1 in einen einheitlichen Zielordner "www",
 * unabhaengig davon ob die Quelle ein MV- oder MZ-Export war.
 *
 * @param {string} contentRoot Quellordner mit index.html
 * @param {string} targetWwwDir Zielordner, z.B. .../build/<projekt>/www
 * @returns {{fileCount: number, totalBytes: number}}
 */
async function importProject(contentRoot, targetWwwDir) {
  await fs.emptyDir(targetWwwDir);

  await fs.copy(contentRoot, targetWwwDir, {
    filter: (src) => {
      const base = path.basename(src);
      return !EXCLUDED_FILES.has(base);
    },
  });

  const stats = await collectStats(targetWwwDir);
  return stats;
}

async function collectStats(dir) {
  let fileCount = 0;
  let totalBytes = 0;

  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        fileCount += 1;
        const stat = await fs.stat(full);
        totalBytes += stat.size;
      }
    }
  }

  await walk(dir);
  return { fileCount, totalBytes };
}

module.exports = {
  importProject,
};
