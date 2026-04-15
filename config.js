// ============================================================
// DigiEDU AI Service Assistant – Konfigurácia v2
// ============================================================

// Načítaj uložené nastavenia z localStorage
const _saved = {
  apiKeyClaude:  localStorage.getItem('digiedu_api_claude')  || '',
  apiKeyGpt:     localStorage.getItem('digiedu_api_gpt')     || '',
  apiKeyCustom:  localStorage.getItem('digiedu_api_custom')  || '',
  endpointCustom:localStorage.getItem('digiedu_endpoint_custom') || '',
  activeModel:   localStorage.getItem('digiedu_model')       || 'haiku',
  activeProvider:localStorage.getItem('digiedu_provider')    || 'claude',
  gasUrl:        localStorage.getItem('digiedu_gas_url')     || ''
};

const CONFIG = {

  // ── API Provideri ─────────────────────────────────────────
  // ADMIN MENU: provider sa nastavuje cez obrazovku Admin
  // KÓD: edituj ACTIVE_PROVIDER a príslušný kľúč/endpoint nižšie

  PROVIDERS: {
    claude: {
      label:    'Claude (Anthropic)',
      url:      'https://api.anthropic.com/v1/messages',
      api_key:  _saved.apiKeyClaude || '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',
      type:     'claude'
    },
    gpt: {
      label:    'GPT (OpenAI)',
      url:      'https://api.openai.com/v1/chat/completions',
      api_key:  _saved.apiKeyGpt || '',
      type:     'openai'
    },
    custom: {
      label:    'Súkromné API',
      url:      _saved.endpointCustom || 'http://localhost:11434/api/chat',
      api_key:  _saved.apiKeyCustom || '',
      type:     'custom'
    }
  },

  ACTIVE_PROVIDER: _saved.activeProvider || 'claude',

  MODELS: {
    haiku: {
      id:     'claude-haiku-4-5-20251001',
      label:  'Haiku',
      input:  0.80,
      output: 4.00
    },
    sonnet: {
      id:     'claude-sonnet-4-5',
      label:  'Sonnet',
      input:  3.00,
      output: 15.00
    },
    gpt4o_mini: {
      id:     'gpt-4o-mini',
      label:  'GPT-4o mini',
      input:  0.15,
      output: 0.60
    },
    gpt4o: {
      id:     'gpt-4o',
      label:  'GPT-4o',
      input:  2.50,
      output: 10.00
    },
    custom: {
      id:     'custom',
      label:  'Custom model',
      input:  0.00,
      output: 0.00
    }
  },

  ACTIVE_MODEL: _saved.activeModel || 'haiku',
  MAX_TOKENS: 4096,

  // API_URL a API_KEY nie sú potrebné – volania idú cez GAS proxy
  get API_MODEL()            { return this.MODELS[this.ACTIVE_MODEL].id; },
  get PRICE_INPUT_PER_MTOK() { return this.MODELS[this.ACTIVE_MODEL].input; },
  get PRICE_OUTPUT_PER_MTOK(){ return this.MODELS[this.ACTIVE_MODEL].output; },
  get MODEL_LABEL()          { return this.MODELS[this.ACTIVE_MODEL].label; },
  get PROVIDER_TYPE()        { return this.PROVIDERS[this.ACTIVE_PROVIDER].type; },

  LIMITS: {
    haiku:  { round1: 0.009, chat: 0.004, kb_gen: 0.0099, grammar: 0.001 },
    sonnet: { round1: 0.035, chat: 0.015, kb_gen: 0.035,  grammar: 0.004 },
    gpt:    { round1: 0.012, chat: 0.005, kb_gen: 0.012,  grammar: 0.001 },
    custom: { round1: 0.050, chat: 0.020, kb_gen: 0.050,  grammar: 0.010 }
  },

  get ACTIVE_LIMITS() {
    const m = this.ACTIVE_MODEL;
    if (m === 'haiku')  return this.LIMITS.haiku;
    if (m === 'sonnet') return this.LIMITS.sonnet;
    if (m.startsWith('gpt')) return this.LIMITS.gpt;
    return this.LIMITS.custom;
  },

  MAX_CHAT_ROUNDS: 5,

  DEFAULT_SYSTEM_PROMPT: `Si skúsený technický helpdesk asistent DigiEDU (slovenský školský digitalizačný program). Pomáhaš L1/L2/L3 technikom riešiť technické a administratívne problémy. Odpovedáš VÝHRADNE po SLOVENSKY. Technické názvy produktov môžu zostať v origináli. Ak detekuješ že otázka vyžaduje manuál alebo návod krok za krokom, ignoruj štruktúru a napíš čistý prehľadný manuál. Vždy odpovedáš iba validným JSON objektom, bez iného textu, komentárov ani markdown.`,

  KB_WEIGHT_MIN:   0.65,
  KB_WEIGHT_MAX:   0.90,
  KB_WEIGHT_SCALE: 100,

  IMPORT_PASSWORD: '1234',
  ADMIN_PASSWORD:  '1234',
  AUTO_EXPORT_THRESHOLD: 30,

  CATEGORIES: {
    HW:    { name: 'HW Problém',              icon: '🖥️',  color: '#3b82f6', prefix: 'HW'    },
    '365': { name: '365 Problém',             icon: '☁️',  color: '#8b5cf6', prefix: '365'   },
    WIFI:  { name: 'WIFI Problém',            icon: '📡',  color: '#10b981', prefix: 'WIFI'  },
    ADMIN: { name: 'Administratívny Problém', icon: '📋',  color: '#f59e0b', prefix: 'ADMIN' },
    OTHER: { name: 'Iný problém',             icon: '❓',  color: '#ef4444', prefix: 'OTHER' }
  },

  CATEGORY_KEYS: ['HW', '365', 'WIFI', 'ADMIN', 'OTHER'],
  DB_STORES: ['HW', '365', 'WIFI', 'ADMIN', 'OTHER', 'EXTRA', 'WEB_KB', 'meta'],
  DB_NAME:    'DigiEDU_KB_v2',
  DB_VERSION: 1
};
