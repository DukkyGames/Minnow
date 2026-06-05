/* data.jsx — app registry, concierge phrases, mock content */

const APPS = [
  { id: 'code',     name: 'Code',          icon: 'code',     tag: 'Build & ship in a live workspace', kbd: 'Reef-side editor, dev server, files' },
  { id: 'chat',     name: 'Chat',          icon: 'chat',     tag: 'Just talk to your model',           kbd: 'No repo, no tools — pure conversation' },
  { id: 'research', name: 'Deep Research',  icon: 'research', tag: 'Send a sub-agent to dig deep',      kbd: 'Multi-step web + source synthesis' },
  { id: 'experts',  name: "Experts' Lab",  icon: 'flask',    tag: 'Compose & test expert agents',      kbd: 'Personas, tools, eval harness' },
  { id: 'bench',    name: 'Benchmarking',  icon: 'bench',    tag: 'Measure models head-to-head',       kbd: 'Throughput, latency, quality' },
  { id: 'settings', name: 'Settings',      icon: 'gear',     tag: 'Models, providers, appearance',     kbd: 'Everything under one roof' },
];

// concierge: keyword routing → app id
function routeIntent(text) {
  const t = (text || '').toLowerCase();
  const rules = [
    { id: 'code',     re: /(code|build|implement|workspace|dev server|repo|fix|debug|refactor|component|feature|ship)/ },
    { id: 'research', re: /(research|investigate|find out|sources|deep dive|look into|compare papers|gather)/ },
    { id: 'experts',  re: /(expert|persona|agent|lab|harness|eval|prompt design)/ },
    { id: 'bench',    re: /(benchmark|measure|throughput|latency|speed|tok\/s|compare models|fastest)/ },
    { id: 'settings', re: /(settings|theme|appearance|provider|model|api key|palette|dark|light)/ },
    { id: 'chat',     re: /(chat|talk|ask|explain|brainstorm|tell me|what is|how do)/ },
  ];
  for (const r of rules) if (r.re.test(t)) return r.id;
  return 'chat';
}

// whimsical "working" lines — whimsical but never silly
const CONCIERGE_LINES = [
  'Casting a line…',
  'Reading the current…',
  'Following the school…',
  'Swimming toward the right app…',
  'Surfacing what you need…',
];

const GREETINGS = ['Good evening', 'Welcome back', 'Evening', 'Ready when you are'];

// mock Code-app data (from screenshot 1)
const THREADS = [
  { title: 'research this codebase and b…', mode: 'BUILD', ago: '10h ago', stat: '117.5 tok/s · TTFT 81.39s · 13k tok' },
  { title: 'Repo research and HTML pre…', mode: 'BUILD', ago: '11h ago', stat: '16.6 tok/s · TTFT 2.29s · 11k tok' },
  { title: '2026 World Cup HTML design', mode: 'BUILD', ago: '11h ago', stat: '1641.3 tok/s · TTFT 1.74s · 19k tok' },
  { title: 'Python test script request',  mode: 'BUILD', ago: '11h ago', stat: '1000.0 tok/s · TTFT 2.34s · 18k tok' },
  { title: 'channel thought experiment',  mode: 'BUILD', ago: '11h ago', stat: '—' },
  { title: 'what is the username and p…', mode: 'GENERAL', ago: '19h ago', stat: '38.2 tok/s · TTFT 44.68s · 20k tok' },
];

const FILE_TREE = [
  { n: '.next', d: 1 }, { n: 'app', d: 1 }, { n: 'components', d: 1 }, { n: 'data', d: 1 },
  { n: 'documentation', d: 1 }, { n: 'lib', d: 1 }, { n: 'node_modules', d: 1 }, { n: 'public', d: 1 },
  { n: 'reference', d: 1 }, { n: 'scripts', d: 1 },
  { n: '.env.local', d: 0 }, { n: '.gitignore', d: 0 }, { n: 'components.json', d: 0 },
  { n: 'eslint.config.mjs', d: 0 }, { n: 'middleware.ts', d: 0 }, { n: 'next.config.ts', d: 0 },
  { n: 'package.json', d: 0 }, { n: 'startup.md', d: 0 }, { n: 'test.py', d: 0 },
  { n: 'tsconfig.json', d: 0 }, { n: 'vitest.config.ts', d: 0 },
];

window.MN = { APPS, routeIntent, CONCIERGE_LINES, GREETINGS, THREADS, FILE_TREE };
