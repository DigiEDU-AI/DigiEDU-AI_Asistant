// ============================================================
// DigiEDU – Google Drive Sync + AI Proxy cez Apps Script
// CORS riešenie: Drive write = no-cors, AI = GET s parametrami
// ============================================================

const DRIVE_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbz7sEoiQ8iPVBJYD-PqU3TfJp-R84nZff4Ts_qRwyMfMBYkVQ-KHJlm9dQb7aH3Aa_E/exec',
  FILE_MAIN_KB: '1a9-HZdxFXmQcmZGlPH65RiEfXn52hcfZ',
  FILE_WEB_KB:  '1EdMGclT3fxbM91DSXUPerYnYJDhHvP7o',
  get isConfigured() { return !!this.GAS_URL && this.GAS_URL.includes('script.google.com'); }
};

// ── Čítanie z Drive (GET – funguje bez CORS problémov) ────────

async function driveReadFile(target = 'main_kb') {
  if (!DRIVE_CONFIG.isConfigured) return null;
  const url = `${DRIVE_CONFIG.GAS_URL}?target=${target}&t=${Date.now()}`;
  const res  = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Drive read ${res.status}`);
  const text = await res.text();
  if (!text || text.trim() === '' || text.trim() === '{}') return null;
  try { return JSON.parse(text); } catch { return null; }
}

// ── Zápis na Drive (no-cors POST – fire & forget) ─────────────
// Prehliadač blokuje odpoveď pri cross-origin POST,
// ale GAS request DOSTANE a zapíše – odpoveď nepotrebujeme.

async function driveWriteFile(target, payload) {
  if (!DRIVE_CONFIG.isConfigured) return;
  const body = JSON.stringify({ action: 'drive_write', target, payload });
  try {
    await fetch(DRIVE_CONFIG.GAS_URL, {
      method:  'POST',
      mode:    'no-cors',          // ← kľúč: ignorujeme CORS blokovanie
      headers: { 'Content-Type': 'text/plain' },
      body
    });
    // no-cors = opaque response, nevieme či OK, ale GAS zapíše
  } catch (err) {
    console.warn('Drive write error:', err.message);
  }
}

// ── AI volanie cez GAS (GET s base64 payload) ─────────────────
// GET requesty nemajú CORS preflight problém

async function gasAICall(model, maxTokens, system, messages) {
  if (!DRIVE_CONFIG.isConfigured) throw new Error('GAS nie je nakonfigurovaný');

  // Zakóduj payload do base64 aby šiel cez GET parameter
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({
    action: 'ai_call', model, max_tokens: maxTokens, system, messages
  }))));

  const url = `${DRIVE_CONFIG.GAS_URL}?action=ai_call&payload=${encodeURIComponent(payload)}`;
  const res  = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`GAS error ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'GAS AI call failed');
  return data.result;
}

// ── Drive init pri štarte ─────────────────────────────────────

async function driveInit() {
  if (!DRIVE_CONFIG.isConfigured) return;
  try {
    const mainCount = await driveLoadMainKB();
    const webCount  = await driveLoadWebKB();
    if (mainCount + webCount > 0) {
      showToast(`Drive KB: ${mainCount + webCount} záznamov`, 'success', 3000);
      await updateHomeCounters();
    }
  } catch (err) {
    console.warn('Drive init:', err.message);
  }
}

async function driveLoadMainKB() {
  try {
    const data = await driveReadFile('main_kb');
    if (!data) return 0;
    let imported = 0;
    for (const cat of CONFIG.CATEGORY_KEYS) {
      for (const entry of (data[cat]?.entries || [])) {
        if (!entry.entry_id) continue;
        if (!(await dbGet(cat, entry.entry_id))) { await dbPut(cat, entry); imported++; }
      }
      if (data[cat]?.tag_dictionary?.length) await mergeTagsToDict(cat, data[cat].tag_dictionary);
    }
    for (const entry of (data['EXTRA']?.entries || [])) {
      if (!entry.entry_id) continue;
      if (!(await dbGet('EXTRA', entry.entry_id))) { await dbPut('EXTRA', entry); imported++; }
    }
    return imported;
  } catch (err) { console.warn('Drive load main:', err.message); return 0; }
}

async function driveLoadWebKB() {
  try {
    const data = await driveReadFile('web_kb');
    if (!data?.entries?.length) return 0;
    let imported = 0;
    for (const entry of data.entries) {
      if (!entry.entry_id) continue;
      if (!(await dbGet('WEB_KB', entry.entry_id))) { await dbPut('WEB_KB', entry); imported++; }
    }
    return imported;
  } catch (err) { console.warn('Drive load web:', err.message); return 0; }
}

async function driveSaveMainKB() {
  const payload = { exported_at: new Date().toISOString(), version: '2.0' };
  for (const cat of CONFIG.CATEGORY_KEYS) {
    payload[cat] = { entries: await dbGetAll(cat), tag_dictionary: await getTagDict(cat) };
  }
  payload['EXTRA'] = { entries: await dbGetAll('EXTRA') };
  await driveWriteFile('main_kb', payload);
}

async function driveSaveWebKB() {
  const allWebKB = await dbGetAll('WEB_KB');
  if (!allWebKB.length) return;
  let existing = { entries: [] };
  try { existing = await driveReadFile('web_kb') || { entries: [] }; } catch {}
  const existIds = new Set((existing.entries || []).map(e => e.entry_id));
  const newItems = allWebKB.filter(e => !existIds.has(e.entry_id));
  if (!newItems.length) return;
  await driveWriteFile('web_kb', {
    exported_at: new Date().toISOString(), version: '2.0',
    entries: [...(existing.entries || []), ...newItems]
  });
}

async function driveAutoSync() {
  if (!DRIVE_CONFIG.isConfigured) return;
  try {
    await driveSaveMainKB();
    await driveSaveWebKB();
    console.log('✅ Drive sync', new Date().toLocaleTimeString('sk-SK'));
  } catch (err) { console.warn('Drive sync:', err.message); }
}

async function driveManualSync() {
  showLoading('Ukladám na Drive...');
  try {
    await driveSaveMainKB();
    await driveSaveWebKB();
    hideLoading();
    showToast('Drive sync dokončený ✅', 'success', 4000);
  } catch (err) {
    hideLoading();
    showToast('Drive chyba: ' + err.message, 'error', 6000);
  }
}

async function driveManualLoad() {
  showLoading('Načítavam z Drive...');
  try {
    const n = (await driveLoadMainKB()) + (await driveLoadWebKB());
    hideLoading();
    await updateHomeCounters();
    showToast(`Drive: ${n} záznamov načítaných`, 'success', 4000);
  } catch (err) {
    hideLoading();
    showToast('Drive chyba: ' + err.message, 'error', 6000);
  }
}
