// ---------------------------------------------------------------------
// Alles innerhalb einer async Funktion, da die Uebersetzungen zur
// Laufzeit vom Hauptprozess geladen werden (der wiederum alle Dateien
// im lang/-Ordner automatisch einliest -- neue Sprache = neue Datei,
// kein Code muss angepasst werden).
// ---------------------------------------------------------------------
async function initApp() {
  const bundle = await window.api.getLanguageBundle();
  const translations = bundle.translations;
  const availableLanguages = bundle.languages; // [{ code, label }, ...]
  const defaultLang = bundle.defaultLang || 'de';

  function t(lang, key, params) {
    const dict = translations[lang] || translations[defaultLang] || {};
    const fallbackDict = translations[defaultLang] || {};
    let str =
      dict[key] !== undefined ? dict[key] : fallbackDict[key] !== undefined ? fallbackDict[key] : key;
    if (params) {
      Object.keys(params).forEach((k) => {
        str = str.split(`{${k}}`).join(params[k]);
      });
    }
    return str;
  }

  // ---------------------------------------------------------------------
  // Element-Referenzen
  // ---------------------------------------------------------------------
  const langSwitchContainer = document.getElementById('langSwitch');

  const btnSelect = document.getElementById('btnSelect');
  const btnImport = document.getElementById('btnImport');
  const pathDisplay = document.getElementById('pathDisplay');
  const detectionHint = document.getElementById('detectionHint');
  const engineSection = document.getElementById('engineSection');
  const nameSection = document.getElementById('nameSection');
  const radioMV = document.getElementById('radioMV');
  const radioMZ = document.getElementById('radioMZ');
  const projectNameInput = document.getElementById('projectName');
  const logEl = document.getElementById('log');

  const configSection = document.getElementById('configSection');
  const capacitorSection = document.getElementById('capacitorSection');
  const outputDirSection = document.getElementById('outputDirSection');
  const backupSection = document.getElementById('backupSection');
  const packageIdInput = document.getElementById('packageId');
  const packageIdHint = document.getElementById('packageIdHint');
  const versionNameInput = document.getElementById('versionName');
  const btnSelectIcon = document.getElementById('btnSelectIcon');
  const iconPathDisplay = document.getElementById('iconPathDisplay');
  const btnPrepareCapacitor = document.getElementById('btnPrepareCapacitor');

  const btnSelectOutputDir = document.getElementById('btnSelectOutputDir');
  const outputDirDisplay = document.getElementById('outputDirDisplay');
  const cleanupAfterBuildCheckbox = document.getElementById('cleanupAfterBuild');
  const btnZipProject = document.getElementById('btnZipProject');

  const buildApkSection = document.getElementById('buildApkSection');
  const btnBuildApk = document.getElementById('btnBuildApk');

  // ---------------------------------------------------------------------
  // Zustand
  // ---------------------------------------------------------------------
  let currentLang = defaultLang;
  let currentSelection = null; // { rootDir, detection, selectedPath }
  let mvNoticeShown = false; // verhindert Mehrfachanzeige des MV-Hinweises pro Projektauswahl
  let importResult = null; // { targetWwwDir, engine, fileCount, totalBytes }
  let selectedIconPath = null;
  let androidBuildDir = null; // gesetzt nach erfolgreichem "Android-Projekt vorbereiten"
  let selectedApkOutputDir = null;
  let packageIdManuallyEdited = false;

  // ---------------------------------------------------------------------
  // Sprachumschalter dynamisch aus den gefundenen Sprachdateien aufbauen
  // ---------------------------------------------------------------------
  availableLanguages.forEach(({ code, label, flag }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'lang-' + code;
    btn.title = label; // Sprachcode weiterhin als Tooltip beim Hovern sichtbar

    if (flag) {
      const img = document.createElement('img');
      img.src = flag;
      img.alt = label;
      img.className = 'lang-flag';
      btn.appendChild(img);
    } else {
      // Kein passendes Flaggenbild gefunden -- Textkuerzel als Rueckfall,
      // damit der Button nie leer/kaputt aussieht.
      btn.textContent = label;
    }

    btn.addEventListener('click', () => setLanguage(code));
    langSwitchContainer.appendChild(btn);
  });

  // ---------------------------------------------------------------------
  // Sprachumschaltung
  // ---------------------------------------------------------------------
  function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(currentLang, el.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(currentLang, el.getAttribute('data-i18n-placeholder'));
    });
    document.querySelectorAll('[data-tip-i18n]').forEach((el) => {
      el.setAttribute('data-tip', t(currentLang, el.getAttribute('data-tip-i18n')));
    });

    Array.from(langSwitchContainer.children).forEach((btn) => {
      btn.classList.toggle('active', btn.id === 'lang-' + currentLang);
    });
  }

  function renderDynamicTexts() {
    // Pfad-/Statusanzeigen neu rendern, falls bereits Werte gesetzt wurden,
    // damit sie beim Sprachwechsel korrekt bleiben (kein Zurückspringen auf
    // Default-Text bei bereits getroffener Auswahl).
    if (currentSelection) {
      pathDisplay.textContent = currentSelection.selectedPath;
      renderDetectionHint(currentSelection.detection);
    }
    if (selectedIconPath) {
      iconPathDisplay.textContent = selectedIconPath;
    }
    if (selectedApkOutputDir) {
      outputDirDisplay.textContent = selectedApkOutputDir;
    }
    if (packageIdInput.value.trim().length > 0) {
      validatePackageIdField();
    }
  }

  function setLanguage(lang) {
    currentLang = lang;
    applyStaticTranslations();
    renderDynamicTexts();
    if (window.api && window.api.setAppLanguage) {
      window.api.setAppLanguage(lang);
    }
  }

  // ---------------------------------------------------------------------
  // Hilfsfunktionen
  // ---------------------------------------------------------------------
  function log(message, type = '') {
    const line = document.createElement('div');
    line.className = 'log-line' + (type ? ' ' + type : '');
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function suggestPackageId(appName) {
    const cleaned = (appName || 'game')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
    return `com.rpgmaker.${cleaned.length > 0 ? cleaned : 'game'}`;
  }

  // Gibt { valid, key, params } statt fertigem Text zurueck, damit die
  // Meldung je nach aktueller Sprache uebersetzt angezeigt werden kann.
  function validatePackageId(packageId) {
    if (!packageId) return { valid: false, key: 'step5.packageIdEmpty' };
    const segments = packageId.split('.');
    if (segments.length < 2) {
      return { valid: false, key: 'step5.packageIdSegments' };
    }
    const pattern = /^[a-z][a-z0-9_]*$/;
    for (const seg of segments) {
      if (!pattern.test(seg)) {
        return { valid: false, key: 'step5.packageIdSegmentInvalid', params: { segment: seg } };
      }
    }
    return { valid: true };
  }

  function validatePackageIdField() {
    const result = validatePackageId(packageIdInput.value.trim());
    packageIdHint.textContent = result.valid
      ? t(currentLang, 'step5.packageIdValid')
      : t(currentLang, result.key, result.params);
    packageIdHint.style.color = result.valid ? 'var(--ok)' : '#e08a8a';
    return result.valid;
  }

  function renderDetectionHint(detection) {
    if (!detection) return;
    if (detection.engine === 'MV') {
      detectionHint.textContent = t(currentLang, 'step2.hintDetectedMV');
    } else if (detection.engine === 'MZ') {
      detectionHint.textContent = t(currentLang, 'step2.hintDetectedMZ');
    } else {
      detectionHint.textContent = t(currentLang, 'step2.hintNotFound');
    }
  }

  function updateImportButtonState() {
    const engineChosen = radioMV.checked || radioMZ.checked;
    const nameFilled = projectNameInput.value.trim().length > 0;
    btnImport.disabled = !(currentSelection && engineChosen && nameFilled);
  }

  // ---------------------------------------------------------------------
  // Schritt 1+2: Projekt auswählen & Engine erkennen
  // ---------------------------------------------------------------------
  btnSelect.addEventListener('click', async () => {
    const sourceType = document.querySelector('input[name="sourceType"]:checked')?.value || 'folder';
    log(sourceType === 'zip' ? t(currentLang, 'step1.logOpenZip') : t(currentLang, 'step1.logOpenFolder'));

    const result = await window.api.selectProject({ sourceType, lang: currentLang });

    if (result.canceled) {
      log(t(currentLang, 'step1.logCanceled'));
      return;
    }

    currentSelection = result;
    pathDisplay.textContent = result.selectedPath;

    engineSection.classList.remove('disabled-section');
    nameSection.classList.remove('disabled-section');

    const { detection } = result;

    radioMV.checked = false;
    radioMZ.checked = false;
    mvNoticeShown = false;

    if (detection.engine === 'MV') {
      radioMV.checked = true;
      log(t(currentLang, 'step2.logDetectedMV'), 'ok');
      mvNoticeShown = true;
      window.api.showMvNotice({ lang: currentLang });
    } else if (detection.engine === 'MZ') {
      radioMZ.checked = true;
      log(t(currentLang, 'step2.logDetectedMZ'), 'ok');
    } else {
      log(t(currentLang, 'step2.logNotDetected'), 'err');
    }
    renderDetectionHint(detection);

    if (detection.projectTitle) {
      projectNameInput.value = detection.projectTitle;
    } else {
      projectNameInput.value = '';
    }

    if (!detection.contentRoot) {
      log(t(currentLang, 'step2.logNoIndexHtml'), 'err');
    } else {
      log(t(currentLang, 'step2.logContentRootFound', { path: detection.contentRoot }));
    }

    updateImportButtonState();
  });

  radioMV.addEventListener('change', () => {
    updateImportButtonState();
    if (radioMV.checked && !mvNoticeShown) {
      mvNoticeShown = true;
      window.api.showMvNotice({ lang: currentLang });
    }
  });
  radioMZ.addEventListener('change', updateImportButtonState);

  packageIdInput.addEventListener('input', () => {
    packageIdManuallyEdited = true;
    validatePackageIdField();
  });

  projectNameInput.addEventListener('input', () => {
    updateImportButtonState();
    if (!packageIdManuallyEdited) {
      packageIdInput.value = suggestPackageId(projectNameInput.value.trim());
      validatePackageIdField();
    }
  });

  // ---------------------------------------------------------------------
  // Schritt 4: Import
  // ---------------------------------------------------------------------
  btnImport.addEventListener('click', async () => {
    if (!currentSelection || !currentSelection.detection.contentRoot) {
      log(t(currentLang, 'step4.logNoContentRoot'), 'err');
      return;
    }

    const engine = radioMV.checked ? 'MV' : radioMZ.checked ? 'MZ' : null;
    const projectName = projectNameInput.value.trim();

    btnImport.disabled = true;
    log(t(currentLang, 'step4.logImporting', { engine, name: projectName }));

    try {
      const res = await window.api.importProject({
        contentRoot: currentSelection.detection.contentRoot,
        engine,
        projectName,
      });

      log(t(currentLang, 'step4.logDone', { count: res.fileCount, size: formatBytes(res.totalBytes) }), 'ok');
      log(t(currentLang, 'step4.logTarget', { path: res.targetWwwDir }), 'ok');

      importResult = res;
      configSection.classList.remove('disabled-section');
      capacitorSection.classList.remove('disabled-section');
      outputDirSection.classList.remove('disabled-section');

      if (!packageIdManuallyEdited) {
        packageIdInput.value = suggestPackageId(projectName);
      }
      validatePackageIdField();
    } catch (err) {
      log(t(currentLang, 'step4.logError', { message: err.message }), 'err');
    } finally {
      updateImportButtonState();
    }
  });

  // ---------------------------------------------------------------------
  // Schritt 5: Icon-Auswahl
  // ---------------------------------------------------------------------
  btnSelectIcon.addEventListener('click', async () => {
    const result = await window.api.selectIcon({ lang: currentLang });
    if (result.canceled) return;

    selectedIconPath = result.iconPath;
    iconPathDisplay.textContent = selectedIconPath;
    log(t(currentLang, 'step5.logIconSelected', { path: selectedIconPath }));
  });

  // ---------------------------------------------------------------------
  // Schritt 6: Android-Projekt vorbereiten
  // ---------------------------------------------------------------------
  window.api.onBuildLog(({ line, stream }) => {
    const type = stream === 'stderr' ? 'err' : '';
    log(line, type);
  });

  btnPrepareCapacitor.addEventListener('click', async () => {
    if (!importResult) {
      log(t(currentLang, 'step6.logNoImport'), 'err');
      return;
    }

    if (!validatePackageIdField()) {
      log(t(currentLang, 'step6.logInvalidPackageId'), 'err');
      return;
    }

    const orientation =
      document.querySelector('input[name="orientation"]:checked')?.value || 'unspecified';
    const minSdkVersion =
      document.querySelector('input[name="minSdk"]:checked')?.value || '30';

    btnPrepareCapacitor.disabled = true;
    log(t(currentLang, 'step6.logStart'));

    try {
      const res = await window.api.prepareCapacitor({
        targetWwwDir: importResult.targetWwwDir,
        appId: packageIdInput.value.trim(),
        appName: projectNameInput.value.trim(),
        versionName: versionNameInput.value.trim() || '1.0.0',
        orientation,
        iconPath: selectedIconPath,
        minSdkVersion,
        lang: currentLang,
      });

      log(t(currentLang, 'step6.logReadyAt', { path: res.buildDir }), 'ok');

      androidBuildDir = res.buildDir;
      backupSection.classList.remove('disabled-section');
      buildApkSection.classList.remove('disabled-section');
    } catch (err) {
      log(t(currentLang, 'step6.logError', { message: err.message }), 'err');
    } finally {
      btnPrepareCapacitor.disabled = false;
    }
  });

  // ---------------------------------------------------------------------
  // Schritt 7: Ausgabeordner für die APK
  // ---------------------------------------------------------------------
  btnSelectOutputDir.addEventListener('click', async () => {
    const result = await window.api.selectApkOutputDir({ lang: currentLang });
    if (result.canceled) return;

    selectedApkOutputDir = result.outputDir;
    outputDirDisplay.textContent = selectedApkOutputDir;
    log(t(currentLang, 'step7.logSelected', { path: selectedApkOutputDir }));
  });

  // ---------------------------------------------------------------------
  // Schritt 8: Android-Projekt sichern (ZIP)
  // ---------------------------------------------------------------------
  btnZipProject.addEventListener('click', async () => {
    if (!androidBuildDir) {
      log(t(currentLang, 'step8.logNoProject'), 'err');
      return;
    }

    btnZipProject.disabled = true;
    log(t(currentLang, 'step8.logZipping'));

    try {
      const result = await window.api.zipAndroidProject({ buildDir: androidBuildDir, lang: currentLang });

      if (result.canceled) {
        log(t(currentLang, 'step8.logCanceled'));
      } else {
        log(t(currentLang, 'step8.logZipDone', { path: result.savedPath }), 'ok');
      }
    } catch (err) {
      log(t(currentLang, 'step8.logZipError', { message: err.message }), 'err');
    } finally {
      btnZipProject.disabled = false;
    }
  });

  // ---------------------------------------------------------------------
  // Schritt 9: APK erstellen (Gradle-Build)
  // ---------------------------------------------------------------------
  btnBuildApk.addEventListener('click', async () => {
    if (!androidBuildDir) {
      log(t(currentLang, 'step9.logNoAndroidProject'), 'err');
      return;
    }

    btnBuildApk.disabled = true;

    try {
      const result = await window.api.buildApk({
        buildDir: androidBuildDir,
        appName: projectNameInput.value.trim(),
        versionName: versionNameInput.value.trim() || '1.0.0',
        outputDir: selectedApkOutputDir,
        cleanupAfterBuild: cleanupAfterBuildCheckbox.checked,
        lang: currentLang,
      });

      if (cleanupAfterBuildCheckbox.checked) {
        androidBuildDir = null;
        backupSection.classList.add('disabled-section');
        buildApkSection.classList.add('disabled-section');
      }
    } catch (err) {
      log(t(currentLang, 'step9.logError', { message: err.message }), 'err');
    } finally {
      btnBuildApk.disabled = false;
    }
  });

  // ---------------------------------------------------------------------
  // Protokoll-Spalte auf exakt dieselbe Höhe wie die linke Spalte bringen
  // ---------------------------------------------------------------------
  function syncLogColumnHeight() {
    const mainColumn = document.querySelector('.main-column');
    const logColumn = document.querySelector('.log-column');
    if (!mainColumn || !logColumn) return;
    logColumn.style.height = mainColumn.offsetHeight + 'px';
  }

  const mainColumnEl = document.querySelector('.main-column');
  if (mainColumnEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncLogColumnHeight).observe(mainColumnEl);
  }
  window.addEventListener('resize', syncLogColumnHeight);

  // ---------------------------------------------------------------------
  // Initialisierung
  // ---------------------------------------------------------------------
  setLanguage(defaultLang);
  syncLogColumnHeight();
}

initApp();
