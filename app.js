// ============================================================
// DigiEDU – Hlavná aplikácia v2 (app.js)
// Nové: jednokolový flow + chat, admin screen, nová KB logika
// ============================================================

// Session ID
window._sessionId = 'sess-' + Date.now().toString(36);

// ── Globálny stav ─────────────────────────────────────────────

let APP = { currentCase: null, currentScreen: 'screen-home' };

function resetCase() {
  APP.currentCase = {
    id: null, category: null, device: null,
    problemText: '', createdAt: null,
    round1Output: null,
    quick_fixes: [],
    chatHistory: [],
    chatRound: 0,
    currentChatInput: '',
    status: null, actualFix: '',
    finalResolution: '', finalNote: '',
    escalated: false,
    tokenUsage: {}
  };
}

// ── Init ──────────────────────────────────────────────────────

async function initApp() {
  try { await dbOpen(); } catch (err) { showToast('Chyba DB', 'error'); }
  renderDeviceDropdown();
  await updateHomeCounters();
  bindUIEvents();
  showScreen('screen-home');

  // Drive sync – načítaj KB zo Drive na pozadí (ak je Client ID nastavený)
  setTimeout(async () => {
    try {
      if (!DRIVE_CONFIG.CLIENT_ID.includes('VLOZ_SEM')) {
        await driveLoadMainKB();
        await driveLoadWebKB();
      }
    } catch(e) { console.warn('Drive init:', e.message); }
  }, 1500);
}

// ── Event bindings ────────────────────────────────────────────

function bindUIEvents() {
  // Home – kategórie
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => startCase(card.dataset.cat));
  });

  // Home – tlačidlá
  document.getElementById('btn-search-kb')?.addEventListener('click', openSearch);
  document.getElementById('btn-import-kb')?.addEventListener('click', () => {
    requirePassword(CONFIG.IMPORT_PASSWORD, () => showModal('modal-import'));
  });
  document.getElementById('btn-backup')?.addEventListener('click', handleBackup);
  document.getElementById('btn-admin')?.addEventListener('click', () => {
    requirePassword(CONFIG.ADMIN_PASSWORD, () => { renderAdminScreen(); showScreen('screen-admin'); });
  });

  // Case form
  document.getElementById('btn-round1')?.addEventListener('click', handleRound1);
  document.getElementById('btn-close-case-form')?.addEventListener('click', openCloseCase);

  // Chat screen
  document.getElementById('btn-chat-send')?.addEventListener('click', handleChatSend);
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
  });
  document.getElementById('btn-close-case-chat')?.addEventListener('click', openCloseCase);
  document.getElementById('btn-handoff-chat')?.addEventListener('click', openHandoff);

  // Close case
  document.getElementById('btn-confirm-close')?.addEventListener('click', confirmCloseCase);
  document.getElementById('close-status-select')?.addEventListener('change', updateCloseCaseForm);

  // Grammar preview
  document.getElementById('btn-grammar-fix')?.addEventListener('click', handleGrammarFix);
  document.getElementById('btn-grammar-accept')?.addEventListener('click', acceptGrammarFix);

  // Summary
  document.getElementById('btn-back-home')?.addEventListener('click', goHome);

  // Admin
  document.getElementById('btn-admin-save')?.addEventListener('click', () => {
    saveAdminSettings();
    showToast('Nastavenia uložené', 'success');
  });
  document.getElementById('btn-drive-sync')?.addEventListener('click', driveManualSync);
  document.getElementById('btn-drive-load')?.addEventListener('click', driveManualLoad);
  document.getElementById('btn-drive-login')?.addEventListener('click', async () => {
    try { await driveLogin(); showToast('Drive: prihlásený ✅', 'success'); } catch(e) { showToast(e.message, 'error'); }
  });
  document.getElementById('admin-drive-client-id')?.addEventListener('change', e => {
    DRIVE_CONFIG.CLIENT_ID = e.target.value.trim();
  });
  document.getElementById('btn-admin-close')?.addEventListener('click', () => {
    showScreen('screen-home');
  });

  // Back buttons
  document.querySelectorAll('.btn-back').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.target || 'screen-home'));
  });

  // Modaly – zatvorenie
  document.querySelectorAll('.modal-overlay, .btn-modal-close').forEach(el => {
    el.addEventListener('click', e => { if (e.target === el || el.classList.contains('btn-modal-close')) hideAllModals(); });
  });

  // Import
  document.getElementById('btn-import-confirm')?.addEventListener('click', handleImportKB);

  // Search
  document.getElementById('search-input')?.addEventListener('input', debounce(handleSearch, 350));
  document.getElementById('search-cat-filter')?.addEventListener('change', handleSearch);
  document.getElementById('search-status-filter')?.addEventListener('change', handleSearch);

  // Handoff services
  document.querySelectorAll('.handoff-service-btn').forEach(btn => {
    btn.addEventListener('click', () => openExternalAI(btn.dataset.service));
  });

  // Device select
  document.getElementById('device-select')?.addEventListener('change', () => {
    const sel = document.getElementById('device-select');
    if (sel.value === '') { document.getElementById('device-info-box')?.classList.add('hidden'); return; }
    showDeviceInfo(DEVICES[parseInt(sel.value)]);
  });

  // Password enter
  document.getElementById('password-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('password-confirm-btn')?.click();
  });

  // KB detail close
  document.getElementById('modal-kb-detail')?.querySelector('.btn-modal-close')?.addEventListener('click', hideAllModals);
}

// ── Štart prípadu ─────────────────────────────────────────────

async function startCase(category) {
  resetCase();
  APP.currentCase.category  = category;
  APP.currentCase.createdAt = new Date().toISOString();
  APP.currentCase.id        = await generateNextId(category);

  const catInfo = CONFIG.CATEGORIES[category] || { name: category, icon: '?' };
  const headerEl = document.getElementById('case-category-label');
  if (headerEl) headerEl.textContent = `${catInfo.icon} ${catInfo.name}`;
  const caseIdEl = document.getElementById('case-id-display');
  if (caseIdEl) caseIdEl.textContent = APP.currentCase.id;

  document.getElementById('hw-section').style.display = category === 'HW' ? 'block' : 'none';
  document.getElementById('problem-text').value = '';
  const devSel = document.getElementById('device-select');
  if (devSel) devSel.value = '';
  document.getElementById('device-info-box')?.classList.add('hidden');

  showScreen('screen-case');
}

function showDeviceInfo(dev) {
  const box = document.getElementById('device-info-box');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="device-info-grid">
      <div><strong>P/N:</strong> ${escapeHtml(dev.pn)||'—'}</div>
      <div><strong>SN:</strong> ${escapeHtml(dev.sn_sample)||'—'}</div>
      <div style="grid-column:1/-1"><strong>Popis:</strong> ${escapeHtml(dev.description?.slice(0,200))||'—'}</div>
    </div>`;
}

// ── KOLO 1 ────────────────────────────────────────────────────

async function handleRound1() {
  const problemText = document.getElementById('problem-text')?.value?.trim();
  if (!problemText) { showToast('Zadajte popis problému', 'warning'); return; }

  const cs = APP.currentCase;
  cs.problemText = problemText;

  if (cs.category === 'HW') {
    const sel = document.getElementById('device-select');
    if (sel?.value !== '') cs.device = DEVICES[parseInt(sel.value)];
  }

  showLoading('AI analyzuje problém...');

  try {
    const kbCtx  = await getKBContextForAI(cs.category, cs.problemText);
    const webCtx = await getWebKBContext(cs.problemText);
    const result = await runRound1(cs, kbCtx, webCtx);

    cs.round1Output = result.data;
    cs.quick_fixes  = (result.data.quick_fixes || []).map(fix => ({
      fix: typeof fix === 'string' ? fix : fix, state: 'untested', note: ''
    }));

    cs.tokenUsage.round1 = {
      input:  result.usage?.input_tokens  || 0,
      output: result.usage?.output_tokens || 0,
      cost:   result.usage
        ? ((result.usage.input_tokens/1e6)*CONFIG.PRICE_INPUT_PER_MTOK + (result.usage.output_tokens/1e6)*CONFIG.PRICE_OUTPUT_PER_MTOK)
        : 0
    };

    // Pridaj otázku technika do chat histórie
    cs.chatHistory.push({
      round: 0, role: 'technician', text: problemText,
      timestamp: new Date().toISOString(), is_manual: false
    });

    hideLoading();
    renderRound1Output(result.data);
    renderQuickFixes(cs.quick_fixes);
    renderTokenBar(result.usage, !!result.demo, 'token-bar-r1');
    updateChatHeader();

    if (result.demo) showToast('Demo režim – API nedostupné', 'warning', 4000);
    showScreen('screen-chat');

  } catch (err) {
    hideLoading();
    showToast('Chyba AI: ' + err.message, 'error');
  }
}

function updateChatHeader() {
  const cs      = APP.currentCase;
  const catInfo = CONFIG.CATEGORIES[cs.category] || { name: cs.category, icon: '?' };
  const el      = document.getElementById('chat-case-header');
  if (!el) return;
  el.innerHTML = `
    <span class="case-id-badge">${escapeHtml(cs.id)}</span>
    <span class="cat-badge">${catInfo.icon} ${catInfo.name}</span>
    ${cs.device ? `<span class="device-badge">🖥️ ${escapeHtml(cs.device.name)}</span>` : ''}
    <span class="chat-round-counter" id="chat-round-counter">Kolo ${cs.chatRound} / ${CONFIG.MAX_CHAT_ROUNDS}</span>
  `;
}

// ── CHAT SEND ─────────────────────────────────────────────────

async function handleChatSend() {
  const cs    = APP.currentCase;
  const input = document.getElementById('chat-input')?.value?.trim();
  if (!input) { showToast('Zadajte otázku', 'warning'); return; }

  if (cs.chatRound >= CONFIG.MAX_CHAT_ROUNDS) {
    showToast(`Dosiahnutý limit ${CONFIG.MAX_CHAT_ROUNDS} kôl. Ukončite prípad.`, 'warning');
    return;
  }

  // Načítaj aktuálne stavy quick fixov
  cs.quick_fixes = readQuickFixes('quick-fixes-container');

  cs.chatRound++;
  cs.currentChatInput = input;
  document.getElementById('chat-input').value = '';

  // Zobraz správu technika
  const techMsg = { round: cs.chatRound, role: 'technician', text: input, timestamp: new Date().toISOString(), is_manual: false };
  cs.chatHistory.push(techMsg);
  renderChatMessage(techMsg);
  renderChatRoundCounter(cs.chatRound, CONFIG.MAX_CHAT_ROUNDS);

  // Disable input počas AI volania
  const sendBtn = document.getElementById('btn-chat-send');
  const inputEl = document.getElementById('chat-input');
  if (sendBtn) sendBtn.disabled = true;
  if (inputEl) inputEl.disabled = true;

  try {
    const kbCtx = await getKBContextForAI(cs.category, input, 3);
    const result = await runChatRound(cs, kbCtx);
    const data   = result.data;

    const aiText = data.is_manual ? data.manual_content : (data.response || '');
    const aiMsg  = {
      round: cs.chatRound, role: 'ai',
      text:  aiText,
      timestamp: new Date().toISOString(),
      is_manual: data.is_manual || false,
      suggested_next: data.suggested_next || null,
      cost: result.usage
        ? ((result.usage.input_tokens/1e6)*CONFIG.PRICE_INPUT_PER_MTOK + (result.usage.output_tokens/1e6)*CONFIG.PRICE_OUTPUT_PER_MTOK)
        : 0
    };
    cs.chatHistory.push(aiMsg);
    renderChatMessage(aiMsg);

    cs.tokenUsage[`chat_${cs.chatRound}`] = {
      input:  result.usage?.input_tokens  || 0,
      output: result.usage?.output_tokens || 0,
      cost:   aiMsg.cost
    };

    // Ulož do WEB KB
    await saveToWebKB({
      topic: input?.slice(0, 80), content: aiText,
      source: `case_${cs.id}_round_${cs.chatRound}`,
      category: cs.category, used_in_case: cs.id,
      is_partial: false, is_draft: false,
      tags: [...(data.tags || []), cs.category.toLowerCase()]
    });

    if (cs.chatRound >= CONFIG.MAX_CHAT_ROUNDS) {
      showToast('Dosiahnutý limit kôl – ukončite prípad', 'warning', 5000);
      if (sendBtn) sendBtn.disabled = true;
      if (inputEl) inputEl.disabled = true;
    } else {
      if (sendBtn) sendBtn.disabled = false;
      if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
    }

    if (result.demo) showToast('Demo režim', 'warning', 3000);

  } catch (err) {
    showToast('Chat chyba: ' + err.message, 'error');
    if (sendBtn) sendBtn.disabled = false;
    if (inputEl) { inputEl.disabled = false; }
  }
}

// ── Uzatvorenie prípadu ───────────────────────────────────────

function openCloseCase() {
  const cs = APP.currentCase;
  cs.quick_fixes = readQuickFixes('quick-fixes-container');
  const hdr = document.getElementById('close-case-id');
  if (hdr) hdr.textContent = cs.id || '—';
  const statusSel = document.getElementById('close-status-select');
  if (statusSel) statusSel.value = cs.escalated ? 'escalated' : '';
  document.getElementById('close-actual-fix').value = '';
  document.getElementById('close-final-note').value = '';
  document.getElementById('grammar-preview-box')?.classList.add('hidden');
  updateCloseCaseForm();
  showScreen('screen-closecase');
}

function updateCloseCaseForm() {
  const status   = document.getElementById('close-status-select')?.value;
  const fixLabel = document.getElementById('actual-fix-label');
  const fixField = document.getElementById('close-actual-fix');
  if (!fixLabel || !fixField) return;
  if (status === 'resolved') {
    fixLabel.textContent = 'Čo reálne vyriešilo problém? *';
    fixField.placeholder = 'Vlastnými slovami – čo fungovalo...';
  } else if (status === 'escalated') {
    fixLabel.textContent = 'Dôvod eskalácie *';
    fixField.placeholder = 'Prečo sa eskaluje, čo ostalo otvorené...';
  } else {
    fixLabel.textContent = 'Poznámka k nevyriešenému stavu';
    fixField.placeholder = 'Voliteľné...';
  }
}

// ── Gramatická oprava ─────────────────────────────────────────

let _grammarCorrected = '';

async function handleGrammarFix() {
  const status = document.getElementById('close-status-select')?.value;
  const text   = document.getElementById('close-actual-fix')?.value?.trim();
  if (!text) { showToast('Zadajte text', 'warning'); return; }

  showLoading('Opravujem gramatiku...');
  const result = await runGrammarFix(text, status, APP.currentCase.category);
  hideLoading();

  _grammarCorrected = result.text;
  const preview = document.getElementById('grammar-preview-box');
  const preText = document.getElementById('grammar-preview-text');
  if (preview && preText) {
    preText.textContent = result.text;
    preview.classList.remove('hidden');
  }
}

function acceptGrammarFix() {
  if (_grammarCorrected) {
    document.getElementById('close-actual-fix').value = _grammarCorrected;
    document.getElementById('grammar-preview-box')?.classList.add('hidden');
    showToast('Text opravený', 'success');
  }
}

async function confirmCloseCase() {
  const status    = document.getElementById('close-status-select')?.value;
  const actualFix = document.getElementById('close-actual-fix')?.value?.trim();
  const finalNote = document.getElementById('close-final-note')?.value?.trim();

  if (!status) { showToast('Vyberte stav prípadu', 'warning'); return; }
  if ((status === 'resolved' || status === 'escalated') && !actualFix) {
    showToast('Vyplňte povinné pole', 'warning'); return;
  }

  const cs = APP.currentCase;
  cs.status          = status;
  cs.actualFix       = actualFix || '';
  cs.finalResolution = actualFix || '';
  cs.finalNote       = finalNote || '';
  if (status === 'escalated') cs.escalated = true;

  showLoading('Generujem KB záznam...');

  try {
    const kbResult = await generateKBEntry(cs);
    cs.tokenUsage.kb_gen = {
      input:  kbResult.usage?.input_tokens  || 0,
      output: kbResult.usage?.output_tokens || 0,
      cost:   kbResult.usage
        ? ((kbResult.usage.input_tokens/1e6)*CONFIG.PRICE_INPUT_PER_MTOK + (kbResult.usage.output_tokens/1e6)*CONFIG.PRICE_OUTPUT_PER_MTOK)
        : 0
    };
    const entry = await saveKBEntry(cs, kbResult.data);
    hideLoading();
    showSummary(entry, kbResult.demo);
  } catch (err) {
    hideLoading();
    showToast('Chyba ukladania: ' + err.message, 'error');
  }
}

// ── Súhrn ─────────────────────────────────────────────────────

function showSummary(entry, isDemo) {
  const container = document.getElementById('summary-content');
  if (!container) { showScreen('screen-home'); return; }

  const totalCost = Object.values(APP.currentCase.tokenUsage || {})
    .reduce((sum, r) => sum + (r.cost || 0), 0);

  const faqH  = (entry.faq || []).map(f =>
    `<div class="qa-pair"><strong>Q:</strong> ${escapeHtml(f.q)}<br><strong>A:</strong> ${escapeHtml(f.a)}</div>`
  ).join('');

  container.innerHTML = `
    <div class="summary-header">
      <div class="summary-id">${escapeHtml(entry.entry_id)}</div>
      <div class="summary-status status-${entry.status}">${statusLabel(entry.status)}</div>
      <div class="summary-cost">Session: $${totalCost.toFixed(5)}</div>
      ${isDemo ? '<div class="demo-badge">Demo KB</div>' : ''}
    </div>
    <div class="summary-grid">
      <div class="summary-section">
        <h3>🎯 Problém</h3>
        <p>${escapeHtml(entry.problem_summary || APP.currentCase.problemText)}</p>
      </div>
      ${entry.device_name ? `<div class="summary-section"><h3>🖥️ Zariadenie</h3><p>${escapeHtml(entry.device_name)}</p></div>` : ''}
      ${entry.final_resolution ? `<div class="summary-section summary-solution"><h3>✅ Riešenie</h3><p>${escapeHtml(entry.final_resolution)}</p></div>` : ''}
      ${faqH ? `<div class="summary-section"><h3>💬 FAQ (ukážka)</h3>${faqH}</div>` : ''}
      <div class="summary-section">
        <h3>🏷️ Tagy</h3>
        <div class="result-tags">${(entry.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      </div>
      <div class="summary-section">
        <h3>💰 Celkové náklady</h3>
        <p>$${totalCost.toFixed(5)} | Chat kôl: ${APP.currentCase.chatRound}</p>
      </div>
    </div>`;

  showScreen('screen-summary');
  setTimeout(() => {
    animateProgress('summary-progress', 1800, () => {
      showToast(`KB záznam ${entry.entry_id} vytvorený`, 'success', 4000);
    });
  }, 200);
}

// ── Handoff ───────────────────────────────────────────────────

function openHandoff() {
  const text = buildHandoffText(APP.currentCase);
  try { navigator.clipboard.writeText(text); showToast('História skopírovaná do schránky', 'success'); } catch {}
  const preview = document.getElementById('handoff-text-preview');
  if (preview) preview.value = text;
  showModal('modal-handoff');
}

function openExternalAI(service) {
  const urls = { chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/' };
  if (urls[service]) { window.open(urls[service], '_blank'); hideAllModals(); }
}

// ── Search ────────────────────────────────────────────────────

function openSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  showModal('modal-search');
}

async function handleSearch() {
  const query  = document.getElementById('search-input')?.value || '';
  const cat    = document.getElementById('search-cat-filter')?.value || '';
  const status = document.getElementById('search-status-filter')?.value || '';
  const results = await searchKB(query, { category: cat || null, status: status || null });
  renderSearchResults(results);
}

// ── Import ────────────────────────────────────────────────────

async function handleImportKB() {
  const files = document.getElementById('import-file-input')?.files;
  if (!files?.length) { showToast('Vyberte súbor', 'warning'); return; }
  showLoading('Importujem...');
  let totalImported = 0, totalSkipped = 0;
  for (const file of files) {
    try {
      const r = await importKBFile(file);
      totalImported += r.imported; totalSkipped += r.skipped;
    } catch (err) { showToast(`Chyba: ${err.message}`, 'error'); }
  }
  hideLoading(); hideAllModals();
  await updateHomeCounters();
  showToast(`Import: ${totalImported} nových, ${totalSkipped} preskočených`, 'success', 5000);
  document.getElementById('import-file-input').value = '';
}

// ── Backup ────────────────────────────────────────────────────

async function handleBackup() {
  showLoading('Generujem zálohy...');
  try {
    const count = await backupAllDBs();
    hideLoading();
    showToast(`Záloha: ${count} databáz stiahnutých`, 'success', 5000);
  } catch (err) { hideLoading(); showToast('Chyba: ' + err.message, 'error'); }
}

// ── Home ──────────────────────────────────────────────────────

async function goHome() {
  resetCase();
  await updateHomeCounters();
  showScreen('screen-home');
}

// ── Helpers ───────────────────────────────────────────────────

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

document.addEventListener('DOMContentLoaded', initApp);
