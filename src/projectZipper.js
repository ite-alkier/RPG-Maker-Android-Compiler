const fs = require('fs-extra');
const archiver = require('archiver');

/**
 * Packt einen Ordner rekursiv in ein ZIP-Archiv.
 *
 * @param {string} sourceDir Ordner, der gezippt werden soll
 * @param {string} outputZipPath Zielpfad der .zip Datei
 * @param {string[]} excludeDirNames Ordnernamen (relativ, beliebige Tiefe),
 *   die ausgeschlossen werden sollen, z.B. ["node_modules"]
 * @returns {Promise<void>}
 */
function zipDirectory(sourceDir, outputZipPath, excludeDirNames = []) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });

    archive.pipe(output);

    const ignorePatterns = excludeDirNames.map((name) => `${name}/**`);
    archive.glob('**/*', {
      cwd: sourceDir,
      ignore: ignorePatterns,
      dot: false,
    });

    archive.finalize();
  });
}

module.exports = { zipDirectory };
