// ============================================================
// DigiEDU – Drive Sync (drive.js)
// Všetko cez GET – žiadny CORS problém
// ============================================================

const DRIVE_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycbz7sEoiQ8iPVBJYD-PqU3TfJp-R84nZff4Ts_qRwyMfMBYkVQ-KHJlm9dQb7aH3Aa_E/exec',
  FILE_MAIN_KB: '1__kYjKHbaSBeWAvx2TL0EyS84uzUAjVM',
  FILE_WEB_KB:  '1EdMGclT3fxbM91DSXUPerYnYJDhHvP7o',
  get isConfigured() { return this.GAS_URL.includes('script.google.com'); }
};

// ── Pomocné: zakóduj dáta do base64 pre GET parameter ────────

function encodePayload(obj) {
  return encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(obj)))));
}

// ── Čítanie z Drive ───────────────────────────────────────────

async function driveReadFile(target) {
  if (!DRIVE_CONFIG.isConfigured) return null;
  try {
    const res  = await fetch(`${DRIVE_CONFIG.GAS_URL}?action=read&target=${target}&t=${Date.now()}`);
    const text = await res.text();
    if (!text || text === '{}' || text === 'null') return null;
    return JSON.parse(text);
  } catch (e) { console.warn('Drive read:', e.message); return null; }
}

// ── Zápis na Drive (iframe form submit – 100% cross-origin) ──
// Fetch s no-cors nedostane GAS správne dáta.
// Form submit cez skrytý iframe funguje vždy bez CORS problémov.

function driveWriteFile(target, payload) {
  if (!DRIVE_CONFIG.isConfigured) return;
  try {
    const data = JSON.stringify(payload);

    // Vytvor skrytý iframe ako target
    let iframe = document.getElementById('_gas_iframe');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id   = '_gas_iframe';
      iframe.name = '_gas_iframe';
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
    }

    // Vytvor a odošli form do iframe
    const form = document.createElement('form');
    form.method  = 'POST';
    form.action  = DRIVE_CONFIG.GAS_URL;
    form.target  = '_gas_iframe';
    form.style.display = 'none';

    const fields = { action: 'write', target, data };
    for (const [name, value] of Object.entries(fields)) {
      const input = document.createElement('input');
      input.type  = 'hidden';
      input.name  = name;
      input.value = value;
      form.appendChild(input);
    }

    document.body.appendChild(form);
    form.submit();
    setTimeout(() => { form.remove(); }, 3000);
    console.log('Drive write submitted:', target, `${Math.round(data.length/1024)}KB`);
  } catch (e) { console.warn('Drive write:', e.message); }
}

// ── AI volanie cez GAS ────────────────────────────────────────

async function gasAICall(model, maxTokens, system, messages) {
  const encoded = encodePayload({ model, max_tokens: maxTokens, system, messages });
  const res  = await fetch(`${DRIVE_CONFIG.GAS_URL}?action=ai_call&payload=${encoded}&t=${Date.now()}`);
  if (!res.ok) throw new Error(`GAS ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'GAS AI failed');
  return data.result;
}

// ── Init: načítaj pri štarte ──────────────────────────────────

async function driveInit() {
  if (!DRIVE_CONFIG.isConfigured) return;
  try {
    let count = 0;
    count += await driveLoadMainKB();
    count += await driveLoadWebKB();
    if (count > 0) {
      await updateHomeCounters();
      showToast(`Drive: ${count} záznamov načítaných`, 'success', 3000);
    }
  } catch (e) { console.warn('Drive init:', e.message); }
}

async function driveLoadMainKB() {
  const data = await driveReadFile('main_kb');
  if (!data) return 0;
  let n = 0;
  for (const cat of CONFIG.CATEGORY_KEYS) {
    for (const e of (data[cat]?.entries || [])) {
      if (e.entry_id && !(await dbGet(cat, e.entry_id))) { await dbPut(cat, e); n++; }
    }
    if (data[cat]?.tag_dictionary?.length) await mergeTagsToDict(cat, data[cat].tag_dictionary);
  }
  for (const e of (data['EXTRA']?.entries || [])) {
    if (e.entry_id && !(await dbGet('EXTRA', e.entry_id))) { await dbPut('EXTRA', e); n++; }
  }
  return n;
}

async function driveLoadWebKB() {
  const data = await driveReadFile('web_kb');
  if (!data?.entries?.length) return 0;
  let n = 0;
  for (const e of data.entries) {
    if (e.entry_id && !(await dbGet('WEB_KB', e.entry_id))) { await dbPut('WEB_KB', e); n++; }
  }
  return n;
}

// ── Uloženie MAIN KB (po potvrdení case) ─────────────────────

async function driveSaveMainKB() {
  const payload = { exported_at: new Date().toISOString(), version: '2.0' };
  for (const cat of CONFIG.CATEGORY_KEYS) {
    payload[cat] = { entries: await dbGetAll(cat), tag_dictionary: await getTagDict(cat) };
  }
  payload['EXTRA'] = { entries: await dbGetAll('EXTRA') };
  await driveWriteFile('main_kb', payload);
  console.log('✅ Drive main KB saved', new Date().toLocaleTimeString());
}

// ── Uloženie WEB KB (nedokončené session) ────────────────────

async function driveSaveWebKB() {
  const all = await dbGetAll('WEB_KB');
  if (!all.length) return;
  const existing = await driveReadFile('web_kb') || { entries: [] };
  const existIds = new Set((existing.entries || []).map(e => e.entry_id));
  const newItems = all.filter(e => !existIds.has(e.entry_id));
  if (!newItems.length) return;
  await driveWriteFile('web_kb', {
    exported_at: new Date().toISOString(), version: '2.0',
    entries: [...(existing.entries || []), ...newItems]
  });
  console.log('✅ Drive web KB saved', newItems.length, 'items');
}

// ── Auto-sync po uzatvorení case ─────────────────────────────

async function driveAutoSync() {
  if (!DRIVE_CONFIG.isConfigured) return;
  await driveSaveMainKB();
  await driveSaveWebKB();
}

// ── Manuálny sync z Admin menu ────────────────────────────────

async function driveManualSync() {
  showLoading('Ukladám na Drive...');
  try { await driveSaveMainKB(); await driveSaveWebKB(); hideLoading(); showToast('Drive sync ✅', 'success'); }
  catch (e) { hideLoading(); showToast('Drive chyba: ' + e.message, 'error'); }
}

async function driveManualLoad() {
  showLoading('Načítavam z Drive...');
  try {
    const n = (await driveLoadMainKB()) + (await driveLoadWebKB());
    await updateHomeCounters(); hideLoading();
    showToast(`Drive: ${n} záznamov`, 'success');
  } catch (e) { hideLoading(); showToast('Drive chyba: ' + e.message, 'error'); }
}

// ── Uloženie nedokončenej session (beforeunload) ──────────────

window.addEventListener('beforeunload', () => {
  if (!DRIVE_CONFIG.isConfigured) return;
  if (APP?.currentCase?.id && !APP?.currentCase?.status) {
    // Session nie je ukončená – ulož do WEB KB
    const draft = {
      entry_id:   'DRAFT-' + APP.currentCase.id,
      session_id: window._sessionId,
      case_id:    APP.currentCase.id,
      category:   APP.currentCase.category,
      problem:    APP.currentCase.problemText,
      chat_history: APP.currentCase.chatHistory || [],
      created_at: APP.currentCase.createdAt,
      saved_at:   new Date().toISOString(),
      is_draft:   true
    };
    dbPut('WEB_KB', draft);
    driveSaveWebKB(); // best-effort pri zatvorení
  }
});
