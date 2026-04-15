// ============================================================
// DigiEDU – UI Utilities v2 (ui.js)
// Nové: chat renderer, admin renderery, token bar, KB detail
// ============================================================

// ── Toast ─────────────────────────────────────────────────────

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  toast.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span>${message}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, duration);
}

// ── Screeny ───────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) { screen.classList.add('active'); window.scrollTo(0,0); }
}

// ── Modaly ────────────────────────────────────────────────────

function showModal(id)  { const m = document.getElementById(id); if (m) { m.classList.add('active'); document.body.classList.add('modal-open'); } }
function hideModal(id)  { const m = document.getElementById(id); if (m) { m.classList.remove('active'); document.body.classList.remove('modal-open'); } }
function hideAllModals(){ document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active')); document.body.classList.remove('modal-open'); }

// ── Loading ───────────────────────────────────────────────────

function showLoading(message = 'Spracovávam...') {
  const o = document.getElementById('loading-overlay');
  if (o) { o.querySelector('.loading-msg').textContent = message; o.classList.add('active'); }
}
function hideLoading() {
  const o = document.getElementById('loading-overlay');
  if (o) o.classList.remove('active');
}

// ── Progress bar ──────────────────────────────────────────────

function animateProgress(elementId, duration = 2000, onDone) {
  const bar  = document.getElementById(elementId);
  if (!bar) { if (onDone) onDone(); return; }
  const fill = bar.querySelector('.progress-fill');
  if (!fill) { if (onDone) onDone(); return; }
  fill.style.width = '0%';
  fill.style.transition = `width ${duration}ms ease-in-out`;
  requestAnimationFrame(() => {
    fill.style.width = '100%';
    setTimeout(() => { if (onDone) onDone(); }, duration + 100);
  });
}

// ── Heslo ─────────────────────────────────────────────────────

function requirePassword(password, onSuccess) {
  const modal = document.getElementById('modal-password');
  const input = document.getElementById('password-input');
  const err   = document.getElementById('password-error');
  if (!modal) { onSuccess(); return; }
  input.value = ''; err.textContent = '';
  showModal('modal-password');

  const handleConfirm = () => {
    if (input.value === password) {
      hideModal('modal-password');
      document.getElementById('password-confirm-btn').removeEventListener('click', handleConfirm);
      onSuccess();
    } else { err.textContent = 'Nesprávne heslo'; input.value = ''; input.focus(); }
  };
  const btn = document.getElementById('password-confirm-btn');
  btn.replaceWith(btn.cloneNode(true));
  document.getElementById('password-confirm-btn').addEventListener('click', handleConfirm);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') handleConfirm(); }, { once: true });
  input.focus();
}

// ── Device dropdown ───────────────────────────────────────────

function renderDeviceDropdown() {
  const sel = document.getElementById('device-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Vyberte zariadenie --</option>';
  (typeof DEVICES !== 'undefined' ? DEVICES : []).forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${d.id}. ${d.name}`;
    sel.appendChild(opt);
  });
}

// ── Quick fixes renderer ──────────────────────────────────────

function renderQuickFixes(fixes, containerId = 'quick-fixes-container') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  (fixes || []).forEach((fix, i) => {
    const tipText = typeof fix === 'string' ? fix : (fix.fix || fix.tip || fix);
    const state   = typeof fix === 'object' ? (fix.state || 'untested') : 'untested';
    const note    = typeof fix === 'object' ? (fix.note || '') : '';
    const item = document.createElement('div');
    item.className = 'quick-fix-item';
    item.dataset.index = i;
    item.innerHTML = `
      <div class="quick-tip-header">
        <span class="tip-num">${i+1}.</span>
        <span class="tip-text">${escapeHtml(tipText)}</span>
      </div>
      <div class="quick-tip-controls">
        <label class="tip-state-label ${state==='untested'?'active':''}" data-state="untested">
          <input type="radio" name="fix_${i}" value="untested" ${state==='untested'?'checked':''}> Neskúšané
        </label>
        <label class="tip-state-label ${state==='failed'?'active':''}" data-state="failed">
          <input type="radio" name="fix_${i}" value="failed" ${state==='failed'?'checked':''}> ❌ Nepomohlo
        </label>
        <label class="tip-state-label ${state==='helped'?'active':''}" data-state="helped">
          <input type="radio" name="fix_${i}" value="helped" ${state==='helped'?'checked':''}> ✅ Pomohlo
        </label>
      </div>
      <input type="text" class="tip-note-input" placeholder="Voliteľná poznámka..." value="${escapeHtml(note)}">
    `;
    item.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', () => {
        item.querySelectorAll('.tip-state-label').forEach(l => l.classList.remove('active'));
        const checked = item.querySelector('input[type="radio"]:checked');
        if (checked) checked.closest('.tip-state-label').classList.add('active');
      });
    });
    container.appendChild(item);
  });
}

function readQuickFixes(containerId = 'quick-fixes-container') {
  const container = document.getElementById(containerId);
  if (!container) return [];
  return Array.from(container.querySelectorAll('.quick-fix-item')).map(item => ({
    fix:   item.querySelector('.tip-text')?.textContent || '',
    state: item.querySelector('input[type="radio"]:checked')?.value || 'untested',
    note:  item.querySelector('.tip-note-input')?.value || ''
  }));
}

// ── Round 1 výstup ────────────────────────────────────────────

function renderRound1Output(data) {
  const container = document.getElementById('round1-output');
  if (!container) return;

  const causes    = (data.probable_causes || []).map((c,i) => `<li><span class="cause-num">${i+1}.</span> ${escapeHtml(c)}</li>`).join('');
  const questions = (data.questions || []).map((q,i) => `<li><strong>Q${i+1}:</strong> ${escapeHtml(q)}</li>`).join('');
  const mainRec   = data.main_recommendation || '';
  const summary   = data.problem_summary || '';

  container.innerHTML = `
    <div class="ai-section section-main-rec">
      <div class="ai-section-header">
        <span class="section-letter section-letter-main">★</span>
        Hlavná odporúčaná rada
      </div>
      <div class="ai-section-body">
        <div class="main-rec-text">${escapeHtml(mainRec)}</div>
        <div class="main-rec-meta"><span class="main-rec-summary">${escapeHtml(summary)}</span></div>
      </div>
    </div>

    <div class="ai-sections-row">
      <div class="ai-section section-causes">
        <div class="ai-section-header"><span class="section-letter">A</span> 3 Pravdepodobné príčiny</div>
        <div class="ai-section-body"><ul class="causes-list">${causes}</ul></div>
      </div>
      <div class="ai-section section-questions">
        <div class="ai-section-header"><span class="section-letter">C</span> 5 Otázok pre zadávateľa</div>
        <div class="ai-section-body"><ul class="questions-list">${questions}</ul></div>
      </div>
    </div>
  `;
}

// ── Chat renderer ─────────────────────────────────────────────

function renderChatMessage(msg, chatContainerId = 'chat-messages') {
  const container = document.getElementById(chatContainerId);
  if (!container) return;
  const div = document.createElement('div');
  div.className = `chat-message chat-${msg.role}`;

  if (msg.is_manual && msg.role === 'ai') {
    div.innerHTML = `
      <div class="chat-bubble chat-bubble-ai chat-bubble-manual">
        <div class="chat-manual-header">📋 Manuál / Návod</div>
        <div class="chat-manual-content">${escapeHtml(msg.text).replace(/\n/g,'<br>')}</div>
        <div class="chat-meta">Kolo ${msg.round} · ${formatDate(msg.timestamp)}</div>
      </div>`;
  } else if (msg.role === 'ai') {
    div.innerHTML = `
      <div class="chat-bubble chat-bubble-ai">
        <div class="chat-text">${escapeHtml(msg.text).replace(/\n/g,'<br>')}</div>
        ${msg.suggested_next ? `<div class="chat-next">→ ${escapeHtml(msg.suggested_next)}</div>` : ''}
        <div class="chat-meta">Kolo ${msg.round} · ${formatDate(msg.timestamp)}
          ${msg.cost ? `· $${msg.cost.toFixed(5)}` : ''}</div>
      </div>`;
  } else {
    div.innerHTML = `
      <div class="chat-bubble chat-bubble-tech">
        <div class="chat-text">${escapeHtml(msg.text)}</div>
        <div class="chat-meta">Technik · ${formatDate(msg.timestamp)}</div>
      </div>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function renderChatRoundCounter(current, max) {
  const el = document.getElementById('chat-round-counter');
  if (!el) return;
  el.textContent = `Kolo ${current} / ${max}`;
  el.className   = `chat-round-counter ${current >= max ? 'at-limit' : ''}`;
}

// ── Token bar ─────────────────────────────────────────────────

function renderTokenBar(usage, isDemo, containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const sesIn   = TOKEN_SESSION.input_tokens;
  const sesOut  = TOKEN_SESSION.output_tokens;
  const sesCost = TOKEN_SESSION.cost_usd;
  const lastIn  = usage?.input_tokens  || usage?.prompt_tokens     || 0;
  const lastOut = usage?.output_tokens || usage?.completion_tokens || 0;
  const lastCost = usage
    ? ((lastIn/1e6)*CONFIG.PRICE_INPUT_PER_MTOK + (lastOut/1e6)*CONFIG.PRICE_OUTPUT_PER_MTOK)
    : 0;
  if (isDemo) {
    container.innerHTML = `<div class="token-bar demo-mode"><span class="token-bar-icon">⚡</span><span class="token-label">DEMO</span><span class="token-sep">·</span><span class="token-label muted">API nedostupné – tokeny sa neminuli</span></div>`;
    return;
  }
  container.innerHTML = `
    <div class="token-bar">
      <div class="token-group">
        <span class="token-bar-icon">🔤</span>
        <span class="token-label muted">Toto volanie:</span>
        <span class="token-val">${fmtNum(lastIn+lastOut)} tok</span>
        <span class="token-val">${lastIn.toLocaleString('sk')} in</span>
        <span class="token-val">${lastOut.toLocaleString('sk')} out</span>
        <span class="token-cost">≈ $${lastCost.toFixed(5)}</span>
      </div>
      <div class="token-sep-v">|</div>
      <div class="token-group">
        <span class="token-bar-icon">📊</span>
        <span class="token-label muted">Session (${TOKEN_SESSION.calls} vol.):</span>
        <span class="token-val">${fmtNum(sesIn+sesOut)} tok</span>
        <span class="token-cost session-cost">≈ $${sesCost.toFixed(5)}</span>
      </div>
      <div class="token-model">
        <span class="token-label muted">${CONFIG.MODEL_LABEL}</span>
      </div>
    </div>`;
}

function fmtNum(n) { return n >= 1000 ? (n/1000).toFixed(1)+'k' : String(n); }

// ── Admin obrazovka renderer ──────────────────────────────────

function renderAdminScreen() {
  const al = CONFIG.ACTIVE_LIMITS;
  const lh = CONFIG.LIMITS.haiku;
  const ls = CONFIG.LIMITS.sonnet;

  document.getElementById('admin-model-select')?.setAttribute('value', CONFIG.ACTIVE_MODEL);
  document.getElementById('admin-provider-select')?.setAttribute('value', CONFIG.ACTIVE_PROVIDER);
  document.getElementById('admin-api-key-claude')  && (document.getElementById('admin-api-key-claude').value  = CONFIG.PROVIDERS.claude.api_key);
  document.getElementById('admin-api-key-gpt')     && (document.getElementById('admin-api-key-gpt').value     = CONFIG.PROVIDERS.gpt.api_key);
  document.getElementById('admin-api-key-custom')  && (document.getElementById('admin-api-key-custom').value  = CONFIG.PROVIDERS.custom.api_key);
  document.getElementById('admin-endpoint-custom') && (document.getElementById('admin-endpoint-custom').value = CONFIG.PROVIDERS.custom.url);

  document.getElementById('admin-limit-h-round1')  && (document.getElementById('admin-limit-h-round1').value  = lh.round1);
  document.getElementById('admin-limit-h-chat')     && (document.getElementById('admin-limit-h-chat').value    = lh.chat);
  document.getElementById('admin-limit-h-kbgen')    && (document.getElementById('admin-limit-h-kbgen').value   = lh.kb_gen);
  document.getElementById('admin-limit-h-grammar')  && (document.getElementById('admin-limit-h-grammar').value = lh.grammar);
  document.getElementById('admin-limit-s-round1')   && (document.getElementById('admin-limit-s-round1').value  = ls.round1);
  document.getElementById('admin-limit-s-chat')      && (document.getElementById('admin-limit-s-chat').value    = ls.chat);
  document.getElementById('admin-limit-s-kbgen')     && (document.getElementById('admin-limit-s-kbgen').value   = ls.kb_gen);
  document.getElementById('admin-limit-s-grammar')   && (document.getElementById('admin-limit-s-grammar').value = ls.grammar);

  document.getElementById('admin-max-rounds')  && (document.getElementById('admin-max-rounds').value  = CONFIG.MAX_CHAT_ROUNDS);
  document.getElementById('admin-kb-weight')   && (document.getElementById('admin-kb-weight').value   = CONFIG.KB_WEIGHT_MIN);
  document.getElementById('admin-sys-prompt')  && (document.getElementById('admin-sys-prompt').value  = CONFIG.DEFAULT_SYSTEM_PROMPT);
}

function saveAdminSettings() {
  CONFIG.ACTIVE_MODEL    = document.getElementById('admin-model-select')?.value    || CONFIG.ACTIVE_MODEL;
  CONFIG.ACTIVE_PROVIDER = document.getElementById('admin-provider-select')?.value || CONFIG.ACTIVE_PROVIDER;

  const claudeKey  = document.getElementById('admin-api-key-claude')?.value;
  const gptKey     = document.getElementById('admin-api-key-gpt')?.value;
  const customKey  = document.getElementById('admin-api-key-custom')?.value;
  const customUrl  = document.getElementById('admin-endpoint-custom')?.value;
  if (claudeKey !== undefined) CONFIG.PROVIDERS.claude.api_key  = claudeKey;
  if (gptKey    !== undefined) CONFIG.PROVIDERS.gpt.api_key     = gptKey;
  if (customKey !== undefined) CONFIG.PROVIDERS.custom.api_key  = customKey;
  if (customUrl !== undefined) CONFIG.PROVIDERS.custom.url      = customUrl;

  const getVal = id => parseFloat(document.getElementById(id)?.value) || 0;
  CONFIG.LIMITS.haiku.round1   = getVal('admin-limit-h-round1')  || CONFIG.LIMITS.haiku.round1;
  CONFIG.LIMITS.haiku.chat     = getVal('admin-limit-h-chat')    || CONFIG.LIMITS.haiku.chat;
  CONFIG.LIMITS.haiku.kb_gen   = getVal('admin-limit-h-kbgen')   || CONFIG.LIMITS.haiku.kb_gen;
  CONFIG.LIMITS.haiku.grammar  = getVal('admin-limit-h-grammar') || CONFIG.LIMITS.haiku.grammar;
  CONFIG.LIMITS.sonnet.round1  = getVal('admin-limit-s-round1')  || CONFIG.LIMITS.sonnet.round1;
  CONFIG.LIMITS.sonnet.chat    = getVal('admin-limit-s-chat')     || CONFIG.LIMITS.sonnet.chat;
  CONFIG.LIMITS.sonnet.kb_gen  = getVal('admin-limit-s-kbgen')   || CONFIG.LIMITS.sonnet.kb_gen;
  CONFIG.LIMITS.sonnet.grammar = getVal('admin-limit-s-grammar') || CONFIG.LIMITS.sonnet.grammar;

  const maxRounds = parseInt(document.getElementById('admin-max-rounds')?.value);
  if (maxRounds > 0) CONFIG.MAX_CHAT_ROUNDS = maxRounds;

  const kbWeight = parseFloat(document.getElementById('admin-kb-weight')?.value);
  if (kbWeight >= 0 && kbWeight <= 1) CONFIG.KB_WEIGHT_MIN = kbWeight;

  const sysPrompt = document.getElementById('admin-sys-prompt')?.value;
  if (sysPrompt?.trim()) CONFIG.DEFAULT_SYSTEM_PROMPT = sysPrompt.trim();
}

// ── KB detail ─────────────────────────────────────────────────

async function showKBDetail(entryId, store) {
  const entry = await dbGet(store, entryId);
  if (!entry) { showToast('Záznam nenájdený', 'error'); return; }
  const modal = document.getElementById('modal-kb-detail');
  const body  = document.getElementById('kb-detail-body');
  if (!modal || !body) return;

  const causes    = (entry.probable_causes || []).map(c => `<li>${escapeHtml(c)}</li>`).join('');
  const fixes     = (entry.quick_fixes || []).map(f => `<li>${f.state==='helped'?'✅':f.state==='failed'?'❌':'○'} ${escapeHtml(f.fix||f.tip||f)}</li>`).join('');
  const chatH     = (entry.chat_history || []).map(c =>
    `<div class="qa-pair chat-${c.role}"><strong>${c.role==='technician'?'Technik':'AI'} (Kolo ${c.round}):</strong> ${escapeHtml(c.text?.slice(0,300))}</div>`
  ).join('');
  const faqH      = (entry.faq || []).map(f =>
    `<div class="qa-pair"><strong>Q:</strong> ${escapeHtml(f.q)}<br><strong>A:</strong> ${escapeHtml(f.a)}</div>`
  ).join('');

  body.innerHTML = `
    <div class="detail-meta">
      <span class="result-id">${escapeHtml(entry.entry_id)}</span>
      <span class="result-cat cat-${entry.category?.toLowerCase()}">${escapeHtml(entry.category)}</span>
      <span class="result-status status-${entry.status}">${statusLabel(entry.status)}</span>
    </div>
    ${entry.device_name ? `<div class="detail-device">🖥️ <strong>${escapeHtml(entry.device_name)}</strong></div>` : ''}
    <div class="detail-section">
      <h3>Problém</h3>
      <p>${escapeHtml(entry.normalized_problem_text || entry.original_problem_text || '')}</p>
    </div>
    ${entry.main_recommendation ? `<div class="detail-section"><h3>★ Hlavná rada</h3><p class="main-rec-text">${escapeHtml(entry.main_recommendation)}</p></div>` : ''}
    ${causes ? `<div class="detail-section"><h3>Pravdepodobné príčiny</h3><ul>${causes}</ul></div>` : ''}
    ${fixes  ? `<div class="detail-section"><h3>Quick fixy</h3><ul>${fixes}</ul></div>` : ''}
    ${entry.final_resolution ? `<div class="detail-section solution-box"><h3>Riešenie</h3><p>${escapeHtml(entry.final_resolution)}</p></div>` : ''}
    ${chatH ? `<div class="detail-section"><h3>Chat história</h3>${chatH}</div>` : ''}
    ${faqH  ? `<div class="detail-section"><h3>FAQ</h3>${faqH}</div>` : ''}
    <div class="detail-section">
      <div class="result-tags">${(entry.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
      <div class="detail-dates">Vytvorený: ${formatDate(entry.created_at)} | Model: ${entry.model_used||'—'} | Cena: $${(entry.total_cost_usd||0).toFixed(5)}</div>
    </div>`;
  showModal('modal-kb-detail');
}

// ── Search results ────────────────────────────────────────────

function renderSearchResults(results, containerId = 'search-results') {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!results.length) { container.innerHTML = '<div class="no-results">Žiadne výsledky</div>'; return; }
  container.innerHTML = results.map(e => `
    <div class="search-result-card" data-id="${escapeHtml(e.entry_id)}" data-store="${escapeHtml(e._store||e.category)}">
      <div class="result-header">
        <span class="result-id">${escapeHtml(e.entry_id)}</span>
        <span class="result-cat cat-${e.category?.toLowerCase()}">${escapeHtml(e.category)}</span>
        <span class="result-status status-${e.status}">${statusLabel(e.status)}</span>
      </div>
      <div class="result-title">${escapeHtml(e.problem_summary||e.original_problem_text?.slice(0,120)||'')}</div>
      ${e.device_name ? `<div class="result-device">🖥️ ${escapeHtml(e.device_name)}</div>` : ''}
      <div class="result-tags">${(e.tags||[]).map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
    </div>`).join('');
  container.querySelectorAll('.search-result-card').forEach(card => {
    card.addEventListener('click', () => showKBDetail(card.dataset.id, card.dataset.store));
  });
}

// ── Counter badges ────────────────────────────────────────────

async function updateHomeCounters() {
  const counters = await getCounters();
  CONFIG.CATEGORY_KEYS.forEach(cat => {
    const c = counters[cat] || {};
    const totalEl = document.getElementById(`counter-total-${cat}`);
    const newEl   = document.getElementById(`counter-new-${cat}`);
    if (totalEl) totalEl.textContent = c.total || 0;
    if (newEl)   { newEl.textContent = c.newSinceExport || 0; newEl.classList.toggle('has-new', (c.newSinceExport||0) > 0); }
  });
  const extraEl = document.getElementById('counter-extra');
  if (extraEl)  extraEl.textContent = `${counters.EXTRA?.total||0} EXTRA · ${counters.WEB_KB?.total||0} WEB KB (${counters.WEB_KB?.drafts||0} draft)`;
}

// ── Helpers ───────────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
function statusLabel(s) {
  return { resolved:'✅ Vyriešené', unresolved:'❌ Nevyriešené', escalated:'⬆️ Eskalované' }[s] || s || '?';
}
function formatDate(iso) {
  if (!iso) return 'N/A';
  try { return new Date(iso).toLocaleDateString('sk-SK'); } catch { return iso; }
}
