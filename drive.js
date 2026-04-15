// ============================================================
// DigiEDU – Google Drive Sync cez Apps Script (drive.js)
// Bez OAuth – funguje automaticky pre všetkých
// ============================================================

const DRIVE_CONFIG = {
  // Google Apps Script Web App URL
  // ← KÓD / ADMIN: ak zmeníš deployment, uprav túto URL
  GAS_URL: 'https://script.google.com/macros/s/AKfycbz7sEoiQ8iPVBJYD-PqU3TfJp-R84nZff4Ts_qRwyMfMBYkVQ-KHJlm9dQb7aH3Aa_E/exec',

  // File IDs na Drive (len pre referenciu, GAS ich pozná)
  FILE_MAIN_KB: '1a9-HZdxFXmQcmZGlPH65RiEfXn52hcfZ',
  FILE_WEB_KB:  '1EdMGclT3fxbM91DSXUPerYnYJDhHvP7o',

  get isConfigured() { return !!this.GAS_URL && this.GAS_URL.includes('script.google.com'); }
};

// ── Čítanie súboru z Drive cez GAS ───────────────────────────

async function driveReadFile(target = 'main_kb') {
  if (!DRIVE_CONFIG.isConfigured) return null;
  const url = `${DRIVE_CONFIG.GAS_URL}?target=${target}&t=${Date.now()}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`Drive read error ${res.status}`);
  const text = await res.text();
  if (!text || text.trim() === '' || text.trim() === 'null') return null;
  try   { return JSON.parse(text); }
  catch { return null; }
}

// ── Zápis súboru na Drive cez GAS ────────────────────────────

async function driveWriteFile(target, payload) {
  if (!DRIVE_CONFIG.isConfigured) return false;
  const res = await fetch(DRIVE_CONFIG.GAS_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'text/plain' }, // GAS vyžaduje text/plain pri no-cors
    body:    JSON.stringify({ target, payload })
  });
  // GAS vráti JSON s {ok: true/false}
  const data = await res.json().catch(() => ({ ok: res.ok }));
  if (!data.ok) throw new Error(data.error || 'Drive write failed');
  return true;
}

// ── Načítanie KB z Drive pri štarte ──────────────────────────

async function driveLoadMainKB() {
  try {
    const data = await driveReadFile('main_kb');
    if (!data) return 0;

    let imported = 0;
    for (const cat of CONFIG.CATEGORY_KEYS) {
      const entries = data[cat]?.entries || [];
      for (const entry of entries) {
        if (!entry.entry_id) continue;
        const existing = await dbGet(cat, entry.entry_id);
        if (!existing) { await dbPut(cat, entry); imported++; }
      }
      if (data[cat]?.tag_dictionary?.length) {
        await mergeTagsToDict(cat, data[cat].tag_dictionary);
      }
    }
    // EXTRA KB
    for (const entry of (data['EXTRA']?.entries || [])) {
      if (!entry.entry_id) continue;
      const existing = await dbGet('EXTRA', entry.entry_id);
      if (!existing) { await dbPut('EXTRA', entry); imported++; }
    }
    return imported;
  } catch (err) {
    console.warn('Drive load main KB:', err.message);
    return 0;
  }
}

async function driveLoadWebKB() {
  try {
    const data = await driveReadFile('web_kb');
    if (!data?.entries?.length) return 0;
    let imported = 0;
    for (const entry of data.entries) {
      if (!entry.entry_id) continue;
      const existing = await dbGet('WEB_KB', entry.entry_id);
      if (!existing) { await dbPut('WEB_KB', entry); imported++; }
    }
    return imported;
  } catch (err) {
    console.warn('Drive load web KB:', err.message);
    return 0;
  }
}

// ── Uloženie celej KB na Drive ────────────────────────────────

async function driveSaveMainKB() {
  const payload = { exported_at: new Date().toISOString(), version: '2.0' };
  for (const cat of CONFIG.CATEGORY_KEYS) {
    const entries  = await dbGetAll(cat);
    const tagDict  = await getTagDict(cat);
    payload[cat]   = { entries, tag_dictionary: tagDict };
  }
  const extra      = await dbGetAll('EXTRA');
  payload['EXTRA'] = { entries: extra };
  await driveWriteFile('main_kb', payload);
}

async function driveSaveWebKB() {
  const allWebKB = await dbGetAll('WEB_KB');
  if (!allWebKB.length) return;

  // Načítaj existujúce z Drive a merge
  let existing = { entries: [] };
  try { existing = await driveReadFile('web_kb') || { entries: [] }; } catch {}

  const existIds  = new Set((existing.entries || []).map(e => e.entry_id));
  const newItems  = allWebKB.filter(e => !existIds.has(e.entry_id));
  if (!newItems.length) return;

  const payload = {
    exported_at: new Date().toISOString(),
    version:     '2.0',
    description: 'WEB KB – relácie a dočasné znalosti',
    entries:     [...(existing.entries || []), ...newItems]
  };
  await driveWriteFile('web_kb', payload);
}

// ── Auto-sync po uložení KB záznamu ──────────────────────────

async function driveAutoSync() {
  if (!DRIVE_CONFIG.isConfigured) return;
  try {
    await driveSaveMainKB();
    await driveSaveWebKB();
    console.log('Drive sync OK', new Date().toLocaleTimeString('sk-SK'));
  } catch (err) {
    console.warn('Drive auto-sync:', err.message);
    showToast('Drive sync chyba: ' + err.message, 'warning', 5000);
  }
}

// ── Manuálny sync z Admin menu ────────────────────────────────

async function driveManualSync() {
  showLoading('Ukladám na Drive...');
  try {
    await driveSaveMainKB();
    await driveSaveWebKB();
    hideLoading();
    showToast('Drive sync dokončený ✅', 'success', 4000);
  } catch (err) {
    hideLoading();
    showToast('Drive sync chyba: ' + err.message, 'error', 6000);
  }
}

async function driveManualLoad() {
  showLoading('Načítavam z Drive...');
  try {
    const mainCount = await driveLoadMainKB();
    const webCount  = await driveLoadWebKB();
    hideLoading();
    await updateHomeCounters();
    showToast(`Drive načítaný: ${mainCount + webCount} záznamov`, 'success', 4000);
  } catch (err) {
    hideLoading();
    showToast('Drive load chyba: ' + err.message, 'error', 6000);
  }
}

// ── Init pri štarte aplikácie ────────────────────────────────

async function driveInit() {
  if (!DRIVE_CONFIG.isConfigured) return;
  try {
    showToast('Načítavam KB z Drive...', 'info', 3000);
    const mainCount = await driveLoadMainKB();
    const webCount  = await driveLoadWebKB();
    if (mainCount + webCount > 0) {
      showToast(`Drive KB: ${mainCount + webCount} záznamov načítaných`, 'success', 4000);
      await updateHomeCounters();
    }
  } catch (err) {
    console.warn('Drive init:', err.message);
  }
}
