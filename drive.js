// ============================================================
// DigiEDU – Google Drive Sync (drive.js)
// Priamy sync do konkrétnych Drive súborov cez Google API
// ============================================================

const DRIVE_CONFIG = {
  // ← SEM VLOŽ OAuth Client ID z Google Cloud Console
  // Typ: Web application | Authorized origin: URL tvojej app
  CLIENT_ID: '968065008924-b2f9hk85qe9115r9ktpj08l8q5f8q1nb.apps.googleusercontent.com',

  // File IDs – cieľové súbory na Google Drive
  FILE_MAIN_KB: '1a9-HZdxFXmQcmZGlPH65RiEfXn52hcfZ',   // Hlavná KB
  FILE_WEB_KB:  '1EdMGclT3fxbM91DSXUPerYnYJDhHvP7o',    // WEB KB (draft relácie)

  SCOPE:    'https://www.googleapis.com/auth/drive.file',
  API_URL:  'https://www.googleapis.com/drive/v3/files',
  UPLOAD_URL: 'https://www.googleapis.com/upload/drive/v3/files',

  // Stav autentifikácie
  _token:       null,
  _tokenExpiry: null,
  get isAuth()  { return !!this._token && Date.now() < this._tokenExpiry; }
};

// ── OAuth – prihlásenie cez popup ─────────────────────────────

function driveLogin() {
  return new Promise((resolve, reject) => {
    if (DRIVE_CONFIG.isAuth) { resolve(DRIVE_CONFIG._token); return; }

    if (!DRIVE_CONFIG.CLIENT_ID || DRIVE_CONFIG.CLIENT_ID.includes('VLOZ_SEM')) {
      reject(new Error('Drive Client ID nie je nastavený. Nastav ho v drive.js → DRIVE_CONFIG.CLIENT_ID alebo v Admin menu.'));
      return;
    }

    const APP_URL = 'https://digiedu-ai.github.io/DigiEDU-AI_Asistant/';
    const params  = new URLSearchParams({
      client_id:     DRIVE_CONFIG.CLIENT_ID,
      redirect_uri:  APP_URL,
      response_type: 'token',
      scope:         DRIVE_CONFIG.SCOPE,
      include_granted_scopes: 'true',
      prompt:        'select_account'
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    const popup   = window.open(authUrl, 'driveAuth', 'width=520,height=640,menubar=no,toolbar=no,location=yes');

    // Čakáme kým popup presmeruje späť na app URL s tokenom v hash
    const interval = setInterval(() => {
      try {
        if (!popup || popup.closed) {
          clearInterval(interval);
          // Skontroluj hash aktuálneho okna – možno sme my boli presmerovaní
          if (window.location.hash.includes('access_token')) {
            const p = new URLSearchParams(window.location.hash.slice(1));
            const token = p.get('access_token');
            if (token) {
              DRIVE_CONFIG._token       = token;
              DRIVE_CONFIG._tokenExpiry = Date.now() + parseInt(p.get('expires_in') || '3600') * 1000;
              window.history.replaceState(null, '', window.location.pathname);
              resolve(token); return;
            }
          }
          reject(new Error('Popup zatvorený bez tokenu'));
          return;
        }
        const hash = popup.location.hash;
        if (hash && hash.includes('access_token')) {
          clearInterval(interval);
          const p     = new URLSearchParams(hash.slice(1));
          const token = p.get('access_token');
          DRIVE_CONFIG._token       = token;
          DRIVE_CONFIG._tokenExpiry = Date.now() + parseInt(p.get('expires_in') || '3600') * 1000;
          popup.close();
          window.history.replaceState(null, '', window.location.pathname);
          resolve(token);
        }
      } catch (e) {
        // Cross-origin block – normálne počas prihlasovania, ignoruj
      }
    }, 600);
  });
}

// ── Čítanie súboru z Drive ────────────────────────────────────

async function driveReadFile(fileId) {
  const token = await driveLogin();
  const res   = await fetch(`${DRIVE_CONFIG.API_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) {
    if (res.status === 404) return null;  // súbor prázdny / neexistuje
    throw new Error(`Drive read error ${res.status}`);
  }
  const text = await res.text();
  if (!text || text.trim() === '') return null;
  try   { return JSON.parse(text); }
  catch { return null; }
}

// ── Zápis/update súboru na Drive ─────────────────────────────

async function driveWriteFile(fileId, data) {
  const token   = await driveLogin();
  const content = JSON.stringify(data, null, 2);
  const blob    = new Blob([content], { type: 'application/json' });

  const res = await fetch(`${DRIVE_CONFIG.UPLOAD_URL}/${fileId}?uploadType=media`, {
    method:  'PATCH',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: blob
  });
  if (!res.ok) throw new Error(`Drive write error ${res.status}: ${await res.text()}`);
  return await res.json();
}

// ── Načítanie KB z Drive pri štarte ──────────────────────────

async function driveLoadMainKB() {
  try {
    showToast('Načítavam KB z Drive...', 'info', 3000);
    const data = await driveReadFile(DRIVE_CONFIG.FILE_MAIN_KB);
    if (!data) { showToast('Drive KB je prázdna – začíname nanovo', 'info'); return; }

    // Import všetkých kategórií z Drive súboru
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
    showToast(`Drive KB načítaná: ${imported} záznamov`, 'success');
    await updateHomeCounters();
  } catch (err) {
    if (err.message.includes('Client ID')) {
      showToast('Drive: nastav Client ID v Admin menu', 'warning', 6000);
    } else {
      console.warn('Drive load chyba:', err.message);
    }
  }
}

async function driveLoadWebKB() {
  try {
    const data = await driveReadFile(DRIVE_CONFIG.FILE_WEB_KB);
    if (!data?.entries?.length) return;
    let imported = 0;
    for (const entry of data.entries) {
      if (!entry.entry_id) continue;
      const existing = await dbGet('WEB_KB', entry.entry_id);
      if (!existing) { await dbPut('WEB_KB', entry); imported++; }
    }
    if (imported) showToast(`WEB KB z Drive: ${imported} záznamov`, 'info');
  } catch (err) {
    console.warn('Drive WEB KB load:', err.message);
  }
}

// ── Uloženie celej KB do Drive ────────────────────────────────

async function driveSaveMainKB() {
  try {
    const payload = { exported_at: new Date().toISOString(), version: '2.0' };
    for (const cat of CONFIG.CATEGORY_KEYS) {
      const entries   = await dbGetAll(cat);
      const tagDict   = await getTagDict(cat);
      payload[cat]    = { entries, tag_dictionary: tagDict };
    }
    // EXTRA KB tiež
    const extra       = await dbGetAll('EXTRA');
    payload['EXTRA']  = { entries: extra };

    await driveWriteFile(DRIVE_CONFIG.FILE_MAIN_KB, payload);
    showToast('KB uložená na Drive ✅', 'success');
  } catch (err) {
    showToast('Drive save chyba: ' + err.message, 'error', 5000);
    console.error('Drive save:', err);
  }
}

// ── Uloženie WEB KB (draft relácie) na Drive ─────────────────

async function driveSaveWebKB() {
  try {
    const allWebKB  = await dbGetAll('WEB_KB');
    const drafts    = allWebKB.filter(e => e.is_draft);
    if (!drafts.length) return;

    // Načítaj existujúce z Drive a merge
    const existing  = await driveReadFile(DRIVE_CONFIG.FILE_WEB_KB) || { entries: [] };
    const existIds  = new Set((existing.entries || []).map(e => e.entry_id));
    const newDrafts = drafts.filter(d => !existIds.has(d.entry_id));

    if (!newDrafts.length) return;

    const payload = {
      exported_at: new Date().toISOString(),
      version:     '2.0',
      description: 'WEB KB – nedokončené relácie a dočasné znalosti',
      entries:     [...(existing.entries || []), ...newDrafts]
    };

    await driveWriteFile(DRIVE_CONFIG.FILE_WEB_KB, payload);
    console.log(`Drive WEB KB: ${newDrafts.length} draft záznamov uložených`);
  } catch (err) {
    console.warn('Drive WEB KB save:', err.message);
  }
}

// ── Auto-sync po uložení KB záznamu ──────────────────────────
// Volané z kb.js → saveKBEntry po každom uzatvorení

async function driveAutoSync() {
  if (!DRIVE_CONFIG.isAuth) return;  // len ak je prihlásený
  try {
    await driveSaveMainKB();
    await driveSaveWebKB();
  } catch (err) {
    console.warn('Drive auto-sync:', err.message);
  }
}

// ── Manuálny sync tlačidlo v Admin ───────────────────────────

async function driveManualSync() {
  showLoading('Synchronizujem s Drive...');
  try {
    await driveLogin();
    await driveSaveMainKB();
    await driveSaveWebKB();
    hideLoading();
    showToast('Drive sync dokončený', 'success', 4000);
  } catch (err) {
    hideLoading();
    showToast('Drive sync chyba: ' + err.message, 'error', 6000);
  }
}

async function driveManualLoad() {
  showLoading('Načítavam z Drive...');
  try {
    await driveLoadMainKB();
    await driveLoadWebKB();
    hideLoading();
  } catch (err) {
    hideLoading();
    showToast('Drive load chyba: ' + err.message, 'error', 6000);
  }
}
