/**
 * Leitet aus einem App-Namen einen sinnvollen Vorschlag fuer die
 * Android Package-ID (Application-ID) ab, z.B. "Mein Tolles Spiel"
 * -> "com.rpgmaker.meintollesspiel".
 *
 * @param {string} appName
 * @param {string} vendorPrefix z.B. "com.deinstudio"
 * @returns {string}
 */
function suggestPackageId(appName, vendorPrefix = 'com.rpgmaker') {
  const cleaned = (appName || 'game')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // Umlaute/Akzente entfernen
    .replace(/[^a-z0-9]/g, '');

  const safeName = cleaned.length > 0 ? cleaned : 'game';
  return `${vendorPrefix}.${safeName}`;
}

/**
 * Validiert eine Android Package-ID nach den offiziellen Regeln:
 * mindestens zwei durch Punkt getrennte Segmente, jedes Segment
 * beginnt mit einem Kleinbuchstaben, danach nur Kleinbuchstaben/Ziffern.
 * (Grossbuchstaben sind technisch erlaubt, wir schraenken hier bewusst
 * auf Kleinbuchstaben ein, um Endnutzer-Fehler zu vermeiden.)
 *
 * @param {string} packageId
 * @returns {{ valid: boolean, reason: string|null }}
 */
function validatePackageId(packageId) {
  if (!packageId || typeof packageId !== 'string') {
    return { valid: false, reason: 'Package-ID darf nicht leer sein.' };
  }

  const segments = packageId.split('.');
  if (segments.length < 2) {
    return {
      valid: false,
      reason: 'Package-ID braucht mindestens zwei Teile, z.B. "com.firma.spielname".',
    };
  }

  const segmentPattern = /^[a-z][a-z0-9_]*$/;
  for (const segment of segments) {
    if (!segmentPattern.test(segment)) {
      return {
        valid: false,
        reason: `Ungueltiger Abschnitt "${segment}". Erlaubt: Kleinbuchstaben, Ziffern, Unterstrich, muss mit Buchstabe beginnen.`,
      };
    }
  }

  return { valid: true, reason: null };
}

module.exports = { suggestPackageId, validatePackageId };
