/* code-app.jsx — the original coding workspace, now an app */
const { useState: useStateC, useRef: useRefC, useEffect: useEffectC } = React;

function CodeApp({ workspace, onAgentMsg }) {
  const { THREADS, FILE_TREE } = window.MN;
  const MODES = ['General', 'Build', 'Plan', 'Reef', 'Debug'];
  const [mode, setMode] = useStateC('General');
  const [msg, setMsg] = useStateC('');
  const [thread, setThread] = useStateC([]); // {role, text}
  const [streaming, setStreaming] = useStateC(false);
  const bodyRef = useRefC(null);

  function send(text) {
    const q = (text ?? msg).trim();
    if (!q || streaming) return;
    setThread(t => [...t, { role: 'user', text: q }]);
    setMsg('');
    setStreaming(true);
    const reply = "On it. I'll scope the change, touch the smallest surface area, and run the dev server to verify. Casting a line through the repo now…";
    let i = 0;
    setThread(t => [...t, { role: 'assistant', text: '' }]);
    const iv = setInterval(() => {
      i += 2;
      setThread(t => {
        const c = [...t]; c[c.length - 1] = { role: 'assistant', text: reply.slice(0, i) }; return c;
      });
      if (i >= reply.length) {
        clearInterval(iv); setStreaming(false);
        onAgentMsg && onAgentMsg('code', 'Finished scoping — ready for your go-ahead.');
      }
    }, 16);
  }

  const actions = [
    { t: 'Build a feature', s: 'Scaffold and implement', i: 'spark' },
    { t: 'Plan a change', s: 'Map it before code', i: 'layers' },
    { t: 'Debug an issue', s: 'Reproduce and fix', i: 'bug' },
    { t: 'Explain this repo', s: 'Get oriented fast', i: 'flask' },
  ];

  return (
    <div className="code-app">
      {/* sub workspace bar */}
      <div className="ws-bar">
        <button className="ws-btn"><Icon name="refresh" size={15} /></button>
        <div className="ws-model">
          <span className="ws-dot" /> Qwen3.6 27B · …
          <Icon name="arrowRight" size={13} style={{ transform: 'rotate(90deg)', opacity: .5 }} />
        </div>
        <button className="ws-pill">Unload</button>
        <div className="ws-wsname"><span className="ws-dot ok" /> Workspace: {workspace}</div>
        <div className="ws-spacer" />
        <div className="ws-path mono">C:\Users\dukky\Documents\{workspace}</div>
        <button className="ws-btn"><Icon name="folder" size={15} /></button>
        <button className="ws-btn"><Icon name="globe" size={15} /></button>
        <button className="ws-btn"><Icon name="search" size={15} /></button>
      </div>

      <div className="code-split">
        {/* left rail */}
        <div className="code-rail">
          <button className="rail-add"><Icon name="plus" size={18} /></button>
          <div className="rail-sessions">
            {Array.from({ length: 14 }, (_, i) => <span key={i} className={'rail-dot ' + (i === 6 ? 'on' : '')} />)}
          </div>
          <div className="rail-bottom">
            <button className="rail-i"><Icon name="bug" size={16} /></button>
            <button className="rail-i"><Icon name="chart" size={16} /></button>
          </div>
        </div>

        {/* main composer / thread */}
        <div className="code-main" ref={bodyRef}>
          {thread.length === 0 ? (
            <div className="code-landing">
              <div className="listening mono"><span className="cc-dot" /> minnow is listening · Qwen3.6 27B · Q4_K_M — LM Studio (local) · vram 23.1/24gb</div>
              <h2 className="land-title">Let's work on <span className="accent">{workspace}</span>.</h2>

              <Composer {...{ MODES, mode, setMode, msg, setMsg, send, streaming }} />

              <div className="dev-card">
                <div className="dev-left">
                  <div className="dev-status mono"><span className="cc-dot" /> DEV SERVER</div>
                  <div className="dev-state">stopped <span className="mono dim">:5173 · this PC</span></div>
                  <div className="dev-port">
                    <span className="mono dim">PORT</span>
                    <span className="port-box mono">5173</span>
                    <button className="seg on">THIS PC</button>
                    <button className="seg">NETWORK</button>
                  </div>
                </div>
                <Stat label="LINES OF CODE" val="15k" />
                <Stat label="SESSIONS" val="17" />
                <Stat label="TOTAL TOKENS" val="0" />
              </div>

              <div className="action-row">
                {actions.map(a => (
                  <button key={a.t} className="action-card" onClick={() => send(a.t + ' — ' + a.s)}>
                    <span className="action-ico"><Icon name={a.i} size={18} /></span>
                    <span className="action-txt"><b>{a.t}</b><i>{a.s}</i></span>
                  </button>
                ))}
              </div>

              <div className="threads-head mono"><span>RECENT THREADS</span><span className="dim">{THREADS.length} chats</span></div>
              <div className="threads-grid">
                {THREADS.map((t, i) => (
                  <button key={i} className="thread-card" onClick={() => send('Continue: ' + t.title)}>
                    <div className="thread-top"><span className="thread-title">{t.title}</span><span className="thread-mode">{t.mode}</span></div>
                    <div className="thread-ago mono dim">{t.ago}</div>
                    <div className="thread-stat mono dim">{t.stat}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="code-thread">
              <div className="thread-scroll">
                {thread.map((m, i) => (
                  <div key={i} className={'msg msg-' + m.role}>
                    {m.role === 'assistant' && <span className="msg-ava"><Icon name="fish" size={16} /></span>}
                    <div className="msg-bubble">{m.text}{streaming && i === thread.length - 1 && <span className="caret" />}</div>
                  </div>
                ))}
              </div>
              <Composer {...{ MODES, mode, setMode, msg, setMsg, send, streaming }} compact />
            </div>
          )}
        </div>

        {/* right: browser + files */}
        <div className="code-right">
          <div className="browser">
            <div className="browser-bar">
              <button className="ws-btn"><Icon name="back" size={14} /></button>
              <button className="ws-btn"><Icon name="arrowRight" size={14} /></button>
              <button className="ws-btn"><Icon name="refresh" size={13} /></button>
              <div className="url mono">localhost:5173</div>
              <button className="go-btn">Go</button>
              <label className="reload mono"><input type="checkbox" defaultChecked /> Auto-reload</label>
            </div>
            <div className="browser-view">
              <div className="bv-placeholder">
                <div className="bv-stripes" />
                <span className="mono">app preview · localhost:5173</span>
              </div>
            </div>
          </div>
          <div className="files">
            <div className="files-head"><span className="mono">FILES</span><Icon name="refresh" size={13} /></div>
            <input className="files-filter mono" placeholder="Filter files…" />
            <div className="files-tree">
              {FILE_TREE.map((f, i) => (
                <div key={i} className={'file-row mono ' + (f.d ? 'dir' : '')}>
                  <Icon name={f.d ? 'folder' : 'book'} size={13} />{f.n}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, val }) {
  return <div className="stat"><div className="stat-label mono">{label}</div><div className="stat-val">{val}</div></div>;
}

function Composer({ MODES, mode, setMode, msg, setMsg, send, streaming, compact }) {
  return (
    <div className={'composer ' + (compact ? 'compact' : '')}>
      <div className="modes">
        {MODES.map(m => (
          <button key={m} className={'mode ' + (mode === m ? 'on' : '')} onClick={() => setMode(m)}>{m}</button>
        ))}
        <span className="modes-spacer" />
        <button className="mode-i"><Icon name="globe" size={15} /></button>
        <span className="spinner" />
      </div>
      <div className="composer-input">
        <button className="comp-i"><Icon name="paperclip" size={17} /></button>
        <button className="comp-i"><Icon name="sliders" size={17} /></button>
        <input className="comp-field" placeholder="Type a message…" value={msg}
          onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} />
        <button className="comp-send" onClick={() => send()} disabled={streaming}><Icon name="arrowRight" size={18} /></button>
      </div>
    </div>
  );
}

window.CodeApp = CodeApp;
