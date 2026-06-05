/* more-apps.jsx — Deep Research, Experts' Lab, Benchmarking */
const { useState: useStateM, useEffect: useEffectM, useRef: useRefM } = React;

/* ---------------- Deep Research ---------------- */
function ResearchApp({ seed, onAgentMsg }) {
  const STEPS = [
    { t: 'Planning the investigation', d: 'Breaking the question into 4 lines of inquiry' },
    { t: 'Searching the open web', d: '23 candidate sources found' },
    { t: 'Reading & ranking sources', d: 'Keeping 9 high-signal sources' },
    { t: 'Cross-checking claims', d: 'Reconciling 3 conflicting figures' },
    { t: 'Synthesizing the brief', d: 'Drafting a sourced summary' },
  ];
  const [query, setQuery] = useStateM(seed || '');
  const [running, setRunning] = useStateM(false);
  const [done, setDone] = useStateM(0);
  const timers = useRefM([]);

  function run(text) {
    const q = (text ?? query).trim(); if (!q || running) return;
    setQuery(q); setRunning(true); setDone(0);
    timers.current.forEach(clearTimeout); timers.current = [];
    STEPS.forEach((_, i) => timers.current.push(setTimeout(() => {
      setDone(i + 1);
      if (i + 1 === STEPS.length) { setRunning(false); onAgentMsg && onAgentMsg('research', 'Your research brief is ready — 9 sources synthesized.'); }
    }, (i + 1) * 900)));
  }
  useEffectM(() => { if (seed) run(seed); return () => timers.current.forEach(clearTimeout); }, []);

  const sources = [
    { tag: 'paper', host: 'arxiv.org', title: 'Scaling laws for local inference', conf: 'High' },
    { tag: 'docs', host: 'lmstudio.ai', title: 'Quantization & VRAM tradeoffs', conf: 'High' },
    { tag: 'blog', host: 'eval.report', title: 'Throughput benchmarks, Q4 vs Q8', conf: 'Med' },
  ];

  return (
    <div className="app-page research">
      <AppHeader icon="research" name="Deep Research" sub="A sub-agent that digs, reads, and reconciles" />
      <div className="app-scroll">
        <div className="app-col">
          <div className="rq">
            <input className="rq-field" placeholder="What should I research? e.g. 'best local model for 24GB VRAM'"
              value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} />
            <button className="rq-go" onClick={() => run()} disabled={running || !query.trim()}>
              {running ? 'Researching…' : 'Research'}
            </button>
          </div>

          {(running || done > 0) && (
            <div className="steps">
              {STEPS.map((s, i) => {
                const state = done > i ? 'done' : (done === i && running ? 'active' : 'todo');
                return (
                  <div key={i} className={'step ' + state}>
                    <span className="step-mark">{state === 'done' ? <Icon name="check" size={13} /> : state === 'active' ? <span className="cc-dot" /> : <span className="step-n mono">{i + 1}</span>}</span>
                    <div className="step-txt"><b>{s.t}</b><i className="dim">{s.d}</i></div>
                  </div>
                );
              })}
            </div>
          )}

          {done >= 2 && (
            <div className="sources">
              <div className="sources-h mono dim">SOURCES</div>
              {sources.map((s, i) => (
                <div key={i} className="source" style={{ animationDelay: i * 90 + 'ms' }}>
                  <span className="source-tag mono">{s.tag}</span>
                  <div className="source-txt"><b>{s.title}</b><i className="mono dim">{s.host}</i></div>
                  <span className={'conf ' + s.conf.toLowerCase()}>{s.conf}</span>
                </div>
              ))}
            </div>
          )}

          {done >= STEPS.length && (
            <div className="brief">
              <div className="brief-h"><Icon name="book" size={16} /> Research brief</div>
              <p>For a 24GB card, a 27B model at Q4_K_M is the sweet spot — it fits in ~23GB of VRAM and sustains usable throughput, while Q8 spills and stalls. Sources broadly agree, with one outlier benchmark that ran on a different runtime.</p>
              <div className="brief-foot mono dim">9 sources · 3 reconciled · drafted just now</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Experts' Lab ---------------- */
function ExpertsApp() {
  const EXPERTS = [
    { name: 'Refactor Otter', role: 'Senior refactoring engineer', model: 'Qwen3.6 27B', tools: ['edit', 'shell', 'tests'], color: 1 },
    { name: 'Schema Eel', role: 'Database & migrations', model: 'Qwen3.6 27B', tools: ['sql', 'edit'], color: 2 },
    { name: 'Docs Dolphin', role: 'Technical writer', model: 'Llama 4 8B', tools: ['search', 'edit'], color: 3 },
    { name: 'Threat Barracuda', role: 'Security reviewer', model: 'Qwen3.6 27B', tools: ['read', 'shell'], color: 4 },
  ];
  const [sel, setSel] = useStateM(0);
  const e = EXPERTS[sel];
  return (
    <div className="app-page experts">
      <AppHeader icon="flask" name="Experts' Lab" sub="Compose, tune, and test expert agents"
        action={<button className="hdr-btn"><Icon name="plus" size={15} /> New expert</button>} />
      <div className="exp-split">
        <div className="exp-list">
          {EXPERTS.map((x, i) => (
            <button key={i} className={'exp-card ' + (sel === i ? 'on' : '')} onClick={() => setSel(i)}>
              <span className={'exp-ava c' + x.color}><Icon name="flask" size={16} /></span>
              <div className="exp-meta"><b>{x.name}</b><i className="dim">{x.role}</i></div>
            </button>
          ))}
        </div>
        <div className="exp-detail">
          <div className="exp-detail-head">
            <span className={'exp-ava lg c' + e.color}><Icon name="flask" size={22} /></span>
            <div><h3>{e.name}</h3><p className="dim">{e.role}</p></div>
          </div>
          <Field label="MODEL" val={e.model} />
          <Field label="SYSTEM PROMPT" val={'You are ' + e.name + ', a focused ' + e.role.toLowerCase() + '. Work in small, verifiable steps and explain your reasoning briefly.'} area />
          <div className="field">
            <div className="field-label mono">TOOLS</div>
            <div className="chips-row">{e.tools.map(t => <span key={t} className="tool-chip mono">{t}</span>)}<button className="tool-chip add">+ add</button></div>
          </div>
          <div className="exp-actions">
            <button className="primary"><Icon name="play" size={15} /> Test in sandbox</button>
            <button className="ghost">Duplicate</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Benchmarking ---------------- */
function BenchApp({ onAgentMsg }) {
  const MODELS = [
    { name: 'Qwen3.6 27B', q: 'Q4_K_M', tps: 117, ttft: 0.81, qual: 92 },
    { name: 'Llama 4 8B',  q: 'Q6_K',   tps: 188, ttft: 0.34, qual: 81 },
    { name: 'Mixtral 8x7B', q: 'Q4_K_M', tps: 64,  ttft: 1.42, qual: 88 },
  ];
  const [run, setRun] = useStateM(0); // 0 idle, 1 running, 2 done
  const [prog, setProg] = useStateM(0);
  function start() {
    if (run === 1) return;
    setRun(1); setProg(0);
    const iv = setInterval(() => setProg(p => {
      if (p >= 100) { clearInterval(iv); setRun(2); onAgentMsg && onAgentMsg('bench', 'Benchmark complete — Llama 4 8B was fastest at 188 tok/s.'); return 100; }
      return p + 4;
    }), 70);
  }
  const maxTps = Math.max(...MODELS.map(m => m.tps));
  return (
    <div className="app-page bench">
      <AppHeader icon="bench" name="Benchmarking" sub="Measure models head-to-head"
        action={<button className="hdr-btn primary" onClick={start}>{run === 1 ? 'Running…' : run === 2 ? 'Re-run' : 'Run benchmark'}</button>} />
      <div className="app-scroll">
        <div className="app-col">
          {run === 1 && <div className="bench-prog"><div className="bench-prog-fill" style={{ width: prog + '%' }} /><span className="mono dim">{prog}% · streaming tokens…</span></div>}
          <div className="bench-grid">
            <div className="bench-row bench-head mono dim"><span>MODEL</span><span>TOK/S</span><span>TTFT</span><span>QUALITY</span></div>
            {MODELS.map((m, i) => (
              <div key={i} className="bench-row">
                <div className="bench-model"><span className="bench-dot" style={{ background: 'var(--accent)' }} /><b>{m.name}</b><span className="mono dim">{m.q}</span></div>
                <div className="bench-bar"><div className="bar" style={{ width: (run === 0 ? 0 : (m.tps / maxTps) * 100) + '%' }} /><span className="mono">{run === 0 ? '—' : m.tps + ' t/s'}</span></div>
                <div className="mono">{run === 0 ? '—' : m.ttft + 's'}</div>
                <div className="bench-qual"><div className="qual-track"><div className="qual-fill" style={{ width: (run === 0 ? 0 : m.qual) + '%' }} /></div><span className="mono">{run === 0 ? '—' : m.qual}</span></div>
              </div>
            ))}
          </div>
          {run === 2 && <div className="bench-note"><Icon name="spark" size={15} /> <b>Llama 4 8B</b> leads on throughput; <b>Qwen3.6 27B</b> wins on quality. Pick by task.</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------- shared bits ---------------- */
function AppHeader({ icon, name, sub, action }) {
  return (
    <div className="app-hdr">
      <span className="app-hdr-ico"><Icon name={icon} size={20} /></span>
      <div className="app-hdr-txt"><h2>{name}</h2><span className="dim">{sub}</span></div>
      <div className="app-hdr-spacer" />
      {action}
    </div>
  );
}
function Field({ label, val, area }) {
  return (
    <div className="field">
      <div className="field-label mono">{label}</div>
      {area ? <div className="field-area">{val}</div> : <div className="field-val">{val}</div>}
    </div>
  );
}

Object.assign(window, { ResearchApp, ExpertsApp, BenchApp });
