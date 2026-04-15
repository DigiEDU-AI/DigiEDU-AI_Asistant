// ============================================================
// DigiEDU – IndexedDB wrapper v2 (db.js)
// Nové: WEB_KB store, DB_VERSION 2, draft záznamy
// ============================================================

let _db = null;

async function dbOpen() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      CONFIG.DB_STORES.forEach(store => {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'entry_id' });
        }
      });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbPut(store, record) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror    = e => reject(e.target.error);
  });
}

async function dbGetAll(store) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbGet(store, key) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbDelete(store, key) {
  const db = await dbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror    = e => reject(e.target.error);
  });
}

// ── Meta / Počítadlá ─────────────────────────────────────────

async function getMeta(key) {
  const rec = await dbGet('meta', key);
  return rec ? rec.value : null;
}

async function setMeta(key, value) {
  await dbPut('meta', { entry_id: key, value });
}

async function getCounters() {
  const counters = {};
  for (const cat of CONFIG.CATEGORY_KEYS) {
    const entries   = await dbGetAll(cat);
    const newCount  = await getMeta(`new_count_${cat}`) || 0;
    const lastExport = await getMeta(`last_export_${cat}`) || null;
    counters[cat] = { total: entries.length, newSinceExport: newCount, lastExport };
  }
  const extra  = await dbGetAll('EXTRA');
  const webKB  = await dbGetAll('WEB_KB');
  const drafts = webKB.filter(e => e.is_draft);
  counters.EXTRA  = { total: extra.length };
  counters.WEB_KB = { total: webKB.length, drafts: drafts.length };
  return counters;
}

async function incrementNewCount(cat) {
  const current = await getMeta(`new_count_${cat}`) || 0;
  await setMeta(`new_count_${cat}`, current + 1);
  return current + 1;
}

async function resetNewCount(cat) {
  await setMeta(`new_count_${cat}`, 0);
  await setMeta(`last_export_${cat}`, new Date().toISOString());
}

async function generateNextId(cat) {
  const entries = await dbGetAll(cat);
  const year    = new Date().getFullYear();
  const num     = (entries.length + 1).toString().padStart(6, '0');
  return `${CONFIG.CATEGORIES[cat]?.prefix || cat}-${year}-${num}`;
}

// ── WEB KB operácie ───────────────────────────────────────────

async function saveToWebKB(entry) {
  const id = `WEB-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const rec = {
    entry_id:   id,
    session_id: window._sessionId || 'unknown',
    topic:      entry.topic || '',
    content:    entry.content || '',
    source:     entry.source || '',
    category:   entry.category || 'GENERAL',
    created_at: new Date().toISOString(),
    used_in_case: entry.used_in_case || null,
    is_partial: entry.is_partial || false,
    is_draft:   entry.is_draft   || false,
    tags:       entry.tags || []
  };
  await dbPut('WEB_KB', rec);
  return rec;
}

async function getDraftWebKBEntries() {
  const all = await dbGetAll('WEB_KB');
  return all.filter(e => e.is_draft);
}

async function markWebKBProcessed(entryId) {
  const rec = await dbGet('WEB_KB', entryId);
  if (rec) {
    rec.is_draft = false;
    rec.processed_at = new Date().toISOString();
    await dbPut('WEB_KB', rec);
  }
}

// ── KB formát – prázdna DB ─────────────────────────────────────

function buildEmptyDB(cat) {
  const now = new Date().toISOString();
  return {
    kb_version:    '2.0',
    category:      cat,
    database_name: cat === 'EXTRA' ? 'EXTRA_KBDataMain' : `${cat}_KBDataMain`,
    description:   cat === 'EXTRA' ? 'Globálna doplnková knowledge base' : `Hlavná KB databáza pre kategóriu ${cat}`,
    created_at:    now,
    updated_at:    now,
    import_rules: {
      accept_update_files: true,
      deduplicate_by:      ['entry_id', 'case_hash'],
      merge_tags:          true
    },
    tag_dictionary: [],
    entries:        []
  };
}

// ── Vyhľadávanie ──────────────────────────────────────────────

async function searchKB(query, filters = {}) {
  const q = (query || '').toLowerCase().trim();
  let results = [];
  const stores = filters.category ? [filters.category] : CONFIG.CATEGORY_KEYS;
  if (filters.includeExtra) stores.push('EXTRA');
  if (filters.includeWebKB) stores.push('WEB_KB');

  for (const store of stores) {
    const entries = await dbGetAll(store);
    for (const e of entries) {
      if (!e.entry_id) continue;
      if (filters.status && e.status !== filters.status) continue;
      const searchable = [
        e.original_problem_text, e.normalized_problem_text,
        e.problem_summary, e.main_recommendation,
        e.actual_fix, e.final_resolution, e.device_name,
        (e.tags || []).join(' '),
        (e.chat_history || []).map(c => c.text).join(' '),
        (e.faq || []).map(f => f.q + ' ' + f.a).join(' ')
      ].join(' ').toLowerCase();
      if (!q || searchable.includes(q)) {
        results.push({ ...e, _store: store });
      }
    }
  }
  return results;
}

// ── Deduplikácia / Cross-reference ─────────────────────────────

async function findSimilarEntries(category, tags, problemText) {
  const entries = await dbGetAll(category);
  const q = (problemText || '').toLowerCase();
  const similar = [];

  for (const e of entries) {
    const eTags = e.tags || [];
    const commonTags = (tags || []).filter(t => eTags.includes(t));
    const textMatch = q && (e.problem_summary || '').toLowerCase().includes(q.slice(0, 30));
    if (commonTags.length >= 2 || textMatch) {
      similar.push({ entry_id: e.entry_id, score: commonTags.length + (textMatch ? 1 : 0) });
    }
  }
  return similar.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ── Tag dictionary ─────────────────────────────────────────────

async function mergeTagsToDict(cat, tags) {
  const dictKey = `tag_dict_${cat}`;
  const current = await getMeta(dictKey) || [];
  const merged  = [...new Set([...current, ...tags])];
  await setMeta(dictKey, merged);
  return merged;
}

async function getTagDict(cat) {
  return await getMeta(`tag_dict_${cat}`) || [];
}

async function getTotalCasesCount() {
  let total = 0;
  for (const cat of CONFIG.CATEGORY_KEYS) {
    const entries = await dbGetAll(cat);
    total += entries.length;
  }
  return total;
}
