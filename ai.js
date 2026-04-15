// ============================================================
// DigiEDU – AI Engine v2 (ai.js)
// Nové: token limity, multi-provider, chat engine, manuál detekcia
// ============================================================

// ── Session token tracker ─────────────────────────────────────

const TOKEN_SESSION = {
  calls: 0, input_tokens: 0, output_tokens: 0,
  get total()    { return this.input_tokens + this.output_tokens; },
  get cost_usd() {
    return (this.input_tokens  / 1_000_000) * CONFIG.PRICE_INPUT_PER_MTOK
         + (this.output_tokens / 1_000_000) * CONFIG.PRICE_OUTPUT_PER_MTOK;
  }
};

function trackTokens(usage) {
  if (!usage) return;
  TOKEN_SESSION.calls++;
  TOKEN_SESSION.input_tokens  += (usage.input_tokens  || usage.prompt_tokens     || 0);
  TOKEN_SESSION.output_tokens += (usage.output_tokens || usage.completion_tokens || 0);
}

// ── Výpočet max_tokens z cost limitu ─────────────────────────

function calcMaxTokens(limitUsd, estimatedInputTokens) {
  const inputCost  = (estimatedInputTokens / 1_000_000) * CONFIG.PRICE_INPUT_PER_MTOK;
  const remaining  = limitUsd - inputCost;
  if (remaining <= 0) return 100;
  const maxOut = Math.floor((remaining / CONFIG.PRICE_OUTPUT_PER_MTOK) * 1_000_000);
  return Math.min(Math.max(maxOut, 100), CONFIG.MAX_TOKENS);
}

// ── AI volanie cez GAS proxy (GET) ───────────────────────────
// GET nemá CORS preflight problém – kľúč skrytý v Apps Script

async function callClaudeAPI(systemPrompt, userMessage, limitUsd) {
  const estInput  = Math.ceil((systemPrompt.length + userMessage.length) / 3.5);
  const maxTokens = limitUsd ? calcMaxTokens(limitUsd, estInput) : CONFIG.MAX_TOKENS;

  const result = await gasAICall(
    CONFIG.API_MODEL,
    maxTokens,
    systemPrompt,
    [{ role: 'user', content: userMessage }]
  );

  const usage = result.usage || null;
  trackTokens(usage);
  return { text: result.content[0].text, usage, maxTokens };
}

// ── GPT API volanie ───────────────────────────────────────────

async function callGPTAPI(systemPrompt, userMessage, limitUsd) {
  const estInput  = Math.ceil((systemPrompt.length + userMessage.length) / 3.5);
  const maxTokens = limitUsd ? calcMaxTokens(limitUsd, estInput) : CONFIG.MAX_TOKENS;

  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${CONFIG.API_KEY}`
    },
    body: JSON.stringify({
      model:      CONFIG.API_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  }
      ]
    })
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`GPT API ${res.status}: ${e}`); }
  const data  = await res.json();
  const usage = {
    input_tokens:  data.usage?.prompt_tokens     || 0,
    output_tokens: data.usage?.completion_tokens || 0
  };
  trackTokens(usage);
  return { text: data.choices[0].message.content, usage, maxTokens };
}

// ── Custom API volanie ────────────────────────────────────────

async function callCustomAPI(systemPrompt, userMessage, limitUsd) {
  const estInput  = Math.ceil((systemPrompt.length + userMessage.length) / 3.5);
  const maxTokens = limitUsd ? calcMaxTokens(limitUsd, estInput) : 2048;

  const headers = { 'Content-Type': 'application/json' };
  if (CONFIG.API_KEY) headers['Authorization'] = `Bearer ${CONFIG.API_KEY}`;

  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: CONFIG.API_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  }
      ],
      stream: false
    })
  });
  if (!res.ok) { const e = await res.text(); throw new Error(`Custom API ${res.status}: ${e}`); }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || data.message?.content || '';
  const usage = {
    input_tokens:  data.usage?.prompt_tokens     || estInput,
    output_tokens: data.usage?.completion_tokens || Math.ceil(text.length / 3.5)
  };
  trackTokens(usage);
  return { text, usage, maxTokens };
}

// ── Jednotné API volanie ──────────────────────────────────────

async function callAI(systemPrompt, userMessage, limitUsd) {
  switch (CONFIG.PROVIDER_TYPE) {
    case 'claude': return await callClaudeAPI(systemPrompt, userMessage, limitUsd);
    case 'openai': return await callGPTAPI(systemPrompt, userMessage, limitUsd);
    case 'custom': return await callCustomAPI(systemPrompt, userMessage, limitUsd);
    default:       return await callClaudeAPI(systemPrompt, userMessage, limitUsd);
  }
}

// ── JSON parser z AI odpovede ─────────────────────────────────

function parseAIJson(text) {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[1] || match[0]); } catch {}
  }
  try { return JSON.parse(text); } catch {}
  return null;
}

// ── Detekcia manuál/návod otázky ─────────────────────────────

function isManualRequest(text) {
  const t = (text || '').toLowerCase();
  const keywords = ['manuál', 'manual', 'návod', 'navod', 'krok za krokom', 'ako nastaviť',
    'ako nastavit', 'ako urobiť', 'ako urobit', 'postup', 'inštalácia', 'instalacia',
    'how to', 'step by step', 'ako to spraviť', 'ako to spravit', 'konfigurácia krok'];
  return keywords.some(k => t.includes(k));
}

// ── Systémový prompt ──────────────────────────────────────────

function buildSystemPrompt(category, extra) {
  const catInfo = CONFIG.CATEGORIES[category] || { name: category };
  const base    = (getMeta && typeof getMeta === 'function')
    ? '' : CONFIG.DEFAULT_SYSTEM_PROMPT;
  return `${CONFIG.DEFAULT_SYSTEM_PROMPT}
Kategória prípadu: ${catInfo.name}.
${extra || ''}`;
}

// ── KOLO 1 – Hlavná analýza ───────────────────────────────────

async function runRound1(caseState, kbContext, webKBContext) {
  const catName  = (CONFIG.CATEGORIES[caseState.category] || {}).name || caseState.category;
  const devBlock = caseState.device
    ? `Zariadenie: ${caseState.device.name} | P/N: ${caseState.device.pn}\nPopis: ${caseState.device.description}` : '';

  const userMsg = `Kategória: ${catName}
${devBlock}
Popis problému: ${caseState.problemText}
${kbContext  ? `\nINTERNÁ KB:\n${kbContext}`  : ''}
${webKBContext ? `\nWEB KB:\n${webKBContext}` : ''}

Vráť VÝHRADNE JSON v tomto formáte (nič iné):
{
  "main_recommendation": "Hlavná rada 500-1000 znakov. Štruktúrovaná, konkrétna, šitá na tento prípad. Prečo nastal, čo overiť, postup, riziká.",
  "probable_causes": ["Príčina 1", "Príčina 2", "Príčina 3"],
  "quick_fixes": ["Quick fix 1", "Quick fix 2", "Quick fix 3"],
  "questions": ["Otázka 1?", "Otázka 2?", "Otázka 3?", "Otázka 4?", "Otázka 5?"],
  "problem_summary": "Jednoriadkové zhrnutie",
  "is_manual_response": false,
  "manual_content": null,
  "tags": ["tag1", "tag2", "tag3"],
  "cross_categories": []
}`;

  const sys    = buildSystemPrompt(caseState.category, '');
  const limit  = CONFIG.ACTIVE_LIMITS.round1;

  try {
    const { text: raw, usage, maxTokens } = await callAI(sys, userMsg, limit);
    const parsed = parseAIJson(raw);
    if (parsed) return { success: true, data: parsed, usage, maxTokens };

    // Čiastočná odpoveď – ulož do WEB KB
    await saveToWebKB({
      topic: caseState.problemText?.slice(0, 80),
      content: raw, source: 'ai_partial', category: caseState.category,
      used_in_case: caseState.id, is_partial: true, is_draft: true,
      tags: ['partial', caseState.category.toLowerCase()]
    });
    return { success: true, data: buildDemoRound1(caseState), usage, maxTokens, demo: true, partial: raw };
  } catch (err) {
    console.error('AI Round1 chyba:', err.message);
    showToast(`AI chyba: ${err.message}`, 'error', 8000);
    return { success: true, data: buildDemoRound1(caseState), demo: true, usage: null, error: err.message };
  }
}

// ── CHAT KOLO (kolo 2–6) ──────────────────────────────────────

async function runChatRound(caseState, kbContext) {
  const catName  = (CONFIG.CATEGORIES[caseState.category] || {}).name || caseState.category;
  const newInput = caseState.currentChatInput || '';
  const isManual = isManualRequest(newInput);

  // Zostavíme históriu chatu
  const chatHistoryText = (caseState.chatHistory || []).map((c, i) =>
    `[Kolo ${c.round}] ${c.role === 'technician' ? 'Technik' : 'AI'}: ${c.text}`
  ).join('\n');

  const fixesSummary = (caseState.quick_fixes || []).map(f =>
    `- ${f.fix}: ${f.state === 'helped' ? '✅' : f.state === 'failed' ? '❌' : '○'}`
  ).join('\n');

  const userMsg = `Kategória: ${catName}
Pôvodný problém: ${caseState.problemText}
Súhrn prvej analýzy: ${caseState.round1Output?.problem_summary || ''}

Quick fixy – výsledky:
${fixesSummary}

História chatu:
${chatHistoryText}

Nová otázka/info od technika: ${newInput}
${kbContext ? `\nINTERNÁ KB:\n${kbContext}` : ''}

${isManual
  ? 'POKYN: Toto je žiadosť o manuál. Ignoruj JSON štruktúru. Vráť JSON: {"is_manual": true, "manual_content": "KOMPLETNÝ MANUÁL s číslovanými krokmi, konkrétny a praktický", "problem_summary": "téma manuálu", "tags": []}'
  : 'Vráť JSON: {"response": "Tvoja odpoveď technikovi – konkrétna, bez opakovania toho čo už vieme", "is_manual": false, "manual_content": null, "suggested_next": "Ďalší krok ak toto nepomôže", "tags": []}'
}`;

  const sys   = buildSystemPrompt(caseState.category, 'Si v chatovom kole pokračovania. Buď konkrétny a priamy.');
  const limit = CONFIG.ACTIVE_LIMITS.chat;

  try {
    const { text: raw, usage, maxTokens } = await callAI(sys, userMsg, limit);
    const parsed = parseAIJson(raw);
    if (parsed) return { success: true, data: parsed, usage, maxTokens, isManual };

    await saveToWebKB({
      topic: newInput?.slice(0, 80), content: raw, source: 'chat_partial',
      category: caseState.category, used_in_case: caseState.id,
      is_partial: true, is_draft: true, tags: ['chat', 'partial']
    });
    return { success: true, data: buildDemoChat(caseState, newInput, isManual), usage, maxTokens, demo: true };
  } catch (err) {
    console.error('Chat AI chyba:', err.message);
    showToast(`AI chyba: ${err.message}`, 'error', 8000);
    return { success: true, data: buildDemoChat(caseState, newInput, isManual), demo: true, error: err.message };
  }
}

// ── Gramatická oprava záverečného textu ───────────────────────

async function runGrammarFix(text, status, category) {
  const statusCtx = {
    resolved:   'Prípad bol VYRIEŠENÝ. Sformuluj krátky záverečný záver čo fungovalo.',
    unresolved: 'Prípad NEBOL vyriešený. Sformuluj popis situácie čo ostalo otvorené.',
    escalated:  'Prípad bol ESKALOVANÝ. Sformuluj dôvod eskalácie v čistej profesionálnej forme.'
  }[status] || '';

  const userMsg = `Oprav gramatiku a sformuluj do ucelenej vety/krátkého odseku:
Text technika: "${text}"
Kontext: ${statusCtx}
Vráť JSON: {"corrected_text": "Opravený a sformulovaný text"}`;

  const sys = `Si jazykový korektor pre DigiEDU helpdesk. Opravíš gramatiku slovenského textu a sformulujete ho do profesionálnej ucelenej vety. Odpovedáš iba validným JSON.`;

  try {
    const { text: raw, usage } = await callAI(sys, userMsg, CONFIG.ACTIVE_LIMITS.grammar);
    const parsed = parseAIJson(raw);
    if (parsed?.corrected_text) return { text: parsed.corrected_text, usage };
  } catch (err) {
    console.warn('Grammar fix chyba:', err.message);
  }
  return { text, usage: null }; // fallback – pôvodný text
}

// ── KB generovanie ─────────────────────────────────────────────

async function generateKBEntry(caseState) {
  const catName = (CONFIG.CATEGORIES[caseState.category] || {}).name || caseState.category;
  const chatHist = (caseState.chatHistory || []).map(c =>
    `${c.role === 'technician' ? 'T' : 'AI'}: ${c.text?.slice(0, 200)}`).join('\n');

  const userMsg = `Vytvor KB záznam pre uzatvorený prípad DigiEDU.
Kategória: ${catName}
Problém: ${caseState.problemText}
Stav: ${caseState.status}
Hlavná rada: ${caseState.round1Output?.main_recommendation?.slice(0, 300)}
Quick fixy: ${(caseState.quick_fixes || []).map(f => `${f.fix}:${f.state}`).join(', ')}
Finálne riešenie: ${caseState.finalResolution || ''}
Chat história (skrátená): ${chatHist}

Vráť JSON:
{
  "normalized_problem_text": "Gramaticky správny popis v SK",
  "problem_summary": "Jednoriadkové zhrnutie",
  "faq": [
    {"q": "Otázka 1?", "a": "Odpoveď 1"},
    {"q": "Otázka 2?", "a": "Odpoveď 2"},
    {"q": "Otázka 3?", "a": "Odpoveď 3"},
    {"q": "Otázka 4?", "a": "Odpoveď 4"}
  ],
  "tags": ["tag1","tag2","tag3","tag4","tag5"],
  "cross_categories": [],
  "related_topics": ["téma1","téma2"],
  "confidence_score": 0.9,
  "sources": []
}`;

  const sys = `Si knowledge base kurátor pre DigiEDU. Generuješ KB záznamy v slovenčine. Odpovedáš iba validným JSON.`;

  try {
    const { text: raw, usage } = await callAI(sys, userMsg, CONFIG.ACTIVE_LIMITS.kb_gen);
    const parsed = parseAIJson(raw);
    if (parsed) return { success: true, data: parsed, usage };
  } catch (err) {
    console.warn('KB gen chyba:', err.message);
  }
  return { success: true, data: buildDemoKBMeta(caseState), demo: true, usage: null };
}

// ── KB kontext pre AI ─────────────────────────────────────────

async function getKBContextForAI(category, problemText, maxEntries = 4) {
  const entries = await dbGetAll(category);
  if (!entries.length) return '';
  const q = (problemText || '').toLowerCase();
  const scored = entries.map(e => {
    const text  = [e.problem_summary, e.main_recommendation, (e.tags || []).join(' ')].join(' ').toLowerCase();
    let score   = 0;
    q.split(' ').forEach(w => { if (w.length > 3 && text.includes(w)) score++; });
    return { e, score };
  }).sort((a, b) => b.score - a.score).slice(0, maxEntries);
  const relevant = scored.filter(s => s.score > 0 || entries.length <= 3).map(s => s.e);
  if (!relevant.length) return '';
  return relevant.map(e =>
    `[${e.entry_id}] ${e.problem_summary}\nRiešenie: ${e.final_resolution || e.actual_fix || 'N/A'}\nTagy: ${(e.tags||[]).join(', ')}`
  ).join('\n---\n');
}

async function getWebKBContext(problemText, maxEntries = 3) {
  const entries = await dbGetAll('WEB_KB');
  if (!entries.length) return '';
  const q = (problemText || '').toLowerCase();
  const scored = entries.filter(e => !e.is_draft).map(e => {
    const text  = [e.topic, e.content, (e.tags || []).join(' ')].join(' ').toLowerCase();
    let score   = 0;
    q.split(' ').forEach(w => { if (w.length > 3 && text.includes(w)) score++; });
    return { e, score };
  }).sort((a, b) => b.score - a.score).slice(0, maxEntries);
  const relevant = scored.filter(s => s.score > 0);
  if (!relevant.length) return '';
  return relevant.map(e => `[WEB_KB] ${e.topic}: ${(e.content || '').slice(0, 300)}`).join('\n---\n');
}

// ── Demo fallback výstupy ─────────────────────────────────────

function buildDemoRound1(cs) {
  const cat  = cs.category;
  const dRec = {
    main_recommendation: `[DEMO] Toto je demo výstup pre kategóriu ${cat}. Claude API nie je dostupné. V reálnom režime tu bude 500-1000 znakov konkrétnej rady pre technika šitej priamo na zadaný problém "${(cs.problemText||'').slice(0,60)}...".`,
    probable_causes: ['Príčina 1 (demo)', 'Príčina 2 (demo)', 'Príčina 3 (demo)'],
    quick_fixes:     ['Quick fix 1 (demo)', 'Quick fix 2 (demo)', 'Quick fix 3 (demo)'],
    questions: ['Otázka 1 pre zadávateľa?', 'Otázka 2 pre zadávateľa?', 'Otázka 3 pre zadávateľa?', 'Otázka 4 pre zadávateľa?', 'Otázka 5 pre zadávateľa?'],
    problem_summary: `Demo prípad – ${cat}: ${(cs.problemText||'').slice(0,80)}`,
    is_manual_response: false, manual_content: null,
    tags: [cat.toLowerCase(), 'demo', 'digiedu'],
    cross_categories: []
  };
  return dRec;
}

function buildDemoChat(cs, input, isManual) {
  if (isManual) return {
    is_manual: true,
    manual_content: `[DEMO MANUÁL]\n\n1. Krok jeden – príklad krokov pre: ${input}\n2. Krok dva\n3. Krok tri\n\nToto je demo, v reálnom režime tu bude kompletný manuál.`,
    problem_summary: input?.slice(0,60),
    tags: ['manual', 'demo']
  };
  return {
    is_manual: false,
    response: `[DEMO CHAT] Odpoveď na: "${(input||'').slice(0,80)}". V reálnom režime tu bude konkrétna AI odpoveď zohľadňujúca celú históriu prípadu.`,
    manual_content: null,
    suggested_next: 'Overte výsledok a ak nepomohlo, pokračujte ďalším kolom.',
    tags: ['demo']
  };
}

function buildDemoKBMeta(cs) {
  return {
    normalized_problem_text: cs.problemText || '',
    problem_summary: `${cs.category} – ${(cs.problemText||'').slice(0,80)}`,
    faq: [
      { q: 'Demo otázka 1?', a: 'Demo odpoveď 1' },
      { q: 'Demo otázka 2?', a: 'Demo odpoveď 2' },
      { q: 'Demo otázka 3?', a: 'Demo odpoveď 3' },
      { q: 'Demo otázka 4?', a: 'Demo odpoveď 4' }
    ],
    tags: [cs.category.toLowerCase(), 'demo', 'digiedu'],
    cross_categories: [], related_topics: [],
    confidence_score: 0.5, sources: []
  };
}

// ── Handoff text ──────────────────────────────────────────────

function buildHandoffText(caseState) {
  const chatLines = (caseState.chatHistory || []).map(c =>
    `[${c.role === 'technician' ? 'Technik' : 'AI'} – Kolo ${c.round}]: ${c.text}`
  ).join('\n');
  return [
    '=== DigiEDU AI Helpdesk – Handoff ===',
    `ID: ${caseState.id} | Kategória: ${caseState.category}`,
    caseState.device ? `Zariadenie: ${caseState.device.name}` : '',
    '',
    '--- PROBLÉM ---', caseState.problemText || '',
    '',
    '--- ANALÝZA (Kolo 1) ---',
    caseState.round1Output?.main_recommendation || '',
    '',
    '--- CHAT HISTÓRIA ---', chatLines,
    '',
    '=== Vložte tento text do vybranej AI služby ==='
  ].filter(l => l !== null).join('\n');
}
