// ============================================================
// DigiEDU – Knowledge Base v2 (kb.js)
// Nové: nová KB štruktúra, FAQ, cross-ref, deduplikácia
// ============================================================

// ── Zostavenie a uloženie KB záznamu ─────────────────────────

async function saveKBEntry(caseState, aiKBMeta) {
  const cat = caseState.category;
  const now = new Date().toISOString();

  // Deduplikácia – hľadáme podobné záznamy
  const similar = await findSimilarEntries(cat, aiKBMeta.tags || [], caseState.problemText);
  const crossRefs = similar.map(s => s.entry_id);

  const entry = {
    entry_id:     caseState.id,
    case_hash:    generateHash(caseState.problemText + caseState.id),
    category:     cat,
    cross_categories: aiKBMeta.cross_categories || [],
    cross_references: crossRefs,
    related_topics:   aiKBMeta.related_topics || [],
    status:       caseState.status,
    created_at:   caseState.createdAt,
    closed_at:    now,
    source_type:  'manual_case',
    model_used:   CONFIG.API_MODEL,
    provider:     CONFIG.ACTIVE_PROVIDER,

    // Zariadenie
    device_name: caseState.device?.name || '',
    device_info: caseState.device ? {
      manufacturer: caseState.device.manufacturer || '',
      model:        caseState.device.name || '',
      pn:           caseState.device.pn || '',
      description:  caseState.device.description || '',
      configuration: caseState.device.note || '',
      asset_notes:  caseState.device.sn_sample || ''
    } : {},

    // Texty problému
    original_problem_text:    caseState.problemText,
    normalized_problem_text:  aiKBMeta.normalized_problem_text || caseState.problemText,
    problem_summary:          aiKBMeta.problem_summary || '',

    // Kolo 1 – plný obsah
    main_recommendation: caseState.round1Output?.main_recommendation || '',
    probable_causes:     caseState.round1Output?.probable_causes     || [],
    quick_fixes:         caseState.quick_fixes || [],
    questions_for_requester: caseState.round1Output?.questions || [],

    // Chat história – každé kolo
    chat_history: caseState.chatHistory || [],
    chat_rounds:  (caseState.chatHistory || []).filter(c => c.role === 'ai').length,

    // Manuály (ak boli vytvorené počas session)
    manuals: (caseState.chatHistory || [])
      .filter(c => c.is_manual && c.role === 'ai')
      .map(c => ({ round: c.round, content: c.text, timestamp: c.timestamp })),

    // Uzatvorenie
    actual_fix:        caseState.actualFix        || '',
    final_resolution:  caseState.finalResolution  || '',
    escalation_reason: caseState.status === 'escalated' ? (caseState.finalResolution || '') : '',
    unresolved_reason: caseState.status === 'unresolved' ? (caseState.finalNote || '') : '',

    // KB meta
    faq:              aiKBMeta.faq     || [],
    tags:             aiKBMeta.tags    || [],
    sources:          aiKBMeta.sources || [],
    confidence_score: aiKBMeta.confidence_score || 0.7,
    language: 'sk',

    // Token / cost tracking
    token_usage: caseState.tokenUsage || {},
    total_cost_usd: Object.values(caseState.tokenUsage || {})
      .reduce((sum, r) => sum + (r.cost || 0), 0)
  };

  await dbPut(cat, entry);
  await incrementNewCount(cat);
  await mergeTagsToDict(cat, entry.tags);

  // Cross-reference update – pridaj ref do podobných záznamov
  for (const refId of crossRefs) {
    const existing = await dbGet(cat, refId);
    if (existing) {
      existing.cross_references = [...new Set([...(existing.cross_references || []), entry.entry_id])];
      await dbPut(cat, existing);
    }
  }

  // Auto-export pri 30+ nových
  const counters = await getCounters();
  if (counters[cat].newSinceExport >= CONFIG.AUTO_EXPORT_THRESHOLD) {
    const blob  = await exportUpdateFile(cat);
    if (blob)   triggerDownload(blob, buildExportFilename(cat, counters[cat]));
    await resetNewCount(cat);
    showToast(`Auto-export ${cat} – ${CONFIG.AUTO_EXPORT_THRESHOLD} záznamov`, 'info');
  }

  // Sync na Drive (ak je prihlásený)
  await driveAutoSync();

  return entry;
}

// ── Hash ─────────────────────────────────────────────────────

function generateHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

// ── Export update súboru ──────────────────────────────────────

async function exportUpdateFile(cat, allEntries) {
  const entries = allEntries || await dbGetAll(cat);
  if (!entries.length) return null;
  entries.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const first = entries[0].created_at?.slice(0, 10) || 'N/A';
  const last  = entries[entries.length - 1].created_at?.slice(0, 10) || 'N/A';
  return new Blob([JSON.stringify({
    update_version:  '2.0',
    category:        cat,
    source_database: `${cat}_KBDataMain`,
    exported_from:   first,
    exported_to:     last,
    records_count:   entries.length,
    exported_at:     new Date().toISOString(),
    entries
  }, null, 2)], { type: 'application/json' });
}

function buildExportFilename(cat, counter) {
  const fmt = d => {
    const dt = new Date(d);
    return `${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}-${dt.getFullYear()}`;
  };
  const today   = fmt(new Date());
  const lastExp = counter?.lastExport ? fmt(counter.lastExport) : today;
  return `${lastExp}_${today}_${cat}_KBUpdateFile.json`;
}

// ── Zálohovanie všetkých DB ───────────────────────────────────

async function backupAllDBs() {
  const stores  = [...CONFIG.CATEGORY_KEYS, 'EXTRA'];
  for (const store of stores) {
    const entries   = await dbGetAll(store);
    const tagDict   = await getTagDict(store);
    const db        = buildEmptyDB(store);
    db.entries      = entries;
    db.tag_dictionary = tagDict;
    db.updated_at   = new Date().toISOString();
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
    triggerDownload(blob, `${store}_KBDataMain_${new Date().toISOString().slice(0,10)}.json`);
    await sleep(300);
  }
  return stores.length;
}

// ── Import KB ─────────────────────────────────────────────────

async function importKBFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async e => {
      try {
        const data   = JSON.parse(e.target.result);
        const result = await processKBImport(data);
        resolve(result);
      } catch (err) { reject(new Error('Neplatný JSON: ' + err.message)); }
    };
    reader.onerror = () => reject(new Error('Chyba čítania'));
    reader.readAsText(file);
  });
}

async function processKBImport(data) {
  let category = data.category;
  let entries  = data.entries || [];

  if (!CONFIG.CATEGORY_KEYS.includes(category) && category !== 'EXTRA') {
    throw new Error(`Neznáma kategória: ${category}`);
  }

  let imported = 0, skipped = 0;
  for (const entry of entries) {
    if (!entry.entry_id) { skipped++; continue; }
    const existing = await dbGet(category, entry.entry_id);
    if (existing) { skipped++; continue; }
    await dbPut(category, entry);
    if (entry.tags?.length) await mergeTagsToDict(category, entry.tags);
    imported++;
  }
  if (data.tag_dictionary?.length) await mergeTagsToDict(category, data.tag_dictionary);
  return { category, imported, skipped, total: entries.length };
}

// ── Utility ───────────────────────────────────────────────────

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
