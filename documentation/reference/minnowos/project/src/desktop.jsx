/* desktop.jsx — the MinnowOS home */
const { useState: useStateD, useEffect: useEffectD, useRef: useRefD } = React;

function Concierge({ onLaunch }) {
  const { routeIntent, CONCIERGE_LINES, APPS } = window.MN;
  const [val, setVal] = useStateD('');
  const [phase, setPhase] = useStateD('idle'); // idle | thinking | done
  const [line, setLine] = useStateD('');
  const [target, setTarget] = useStateD(null);
  const timers = useRefD([]);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  useEffectD(() => () => clearTimers(), []);

  function submit(text) {
    const q = (text ?? val).trim();
    if (!q || phase === 'thinking') return;
    const id = routeIntent(q);
    const app = APPS.find(a => a.id === id);
    setTarget(app);
    setPhase('thinking');
    clearTimers();
    const seq = [...CONCIERGE_LINES].sort(() => Math.random() - .5).slice(0, 3);
    seq.forEach((l, i) => timers.current.push(setTimeout(() => setLine(l), i * 620)));
    timers.current.push(setTimeout(() => {
      setLine('Opening ' + app.name + '…');
      setPhase('done');
    }, seq.length * 620));
    timers.current.push(setTimeout(() => {
      onLaunch(id, q);
      setVal(''); setPhase('idle'); setLine(''); setTarget(null);
    }, seq.length * 620 + 720));
  }

  const chips = ['Build a feature', 'Research a topic', 'Benchmark two models', 'Adjust my theme'];

  return (
    <div className="concierge">
      <div className={'cc-input ' + (phase !== 'idle' ? 'busy' : '')}>
        <div className="cc-fish"><Icon name="fish" size={22} /></div>
        <input
          className="cc-field"
          placeholder="What would you like to do today?"
          value={val}
          disabled={phase !== 'idle'}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
          autoFocus
        />
        <button className="cc-send" onClick={() => submit()} disabled={!val.trim() || phase !== 'idle'} aria-label="Send">
          <Icon name="arrowUp" size={18} />
        </button>
      </div>

      <div className={'cc-status ' + (phase !== 'idle' ? 'show' : '')}>
        {phase !== 'idle' && (
          <>
            <span className="cc-dot" />
            <span className="mono">{line}</span>
          </>
        )}
      </div>

      {phase === 'idle' && (
        <div className="cc-chips">
          {chips.map(c => (
            <button key={c} className="cc-chip" onClick={() => { setVal(c); submit(c); }}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function AppTile({ app, onLaunch, variant }) {
  return (
    <button className={'tile tile-' + variant} onClick={() => onLaunch(app.id)} title={app.tag}>
      <span className="tile-ico"><Icon name={app.icon} size={variant === 'dock' ? 24 : 26} /></span>
      <span className="tile-name">{app.name}</span>
      {variant === 'grid' && <span className="tile-tag">{app.tag}</span>}
    </button>
  );
}

function MiniPreview({ inst, app, style, onRestore, onClose }) {
  // style: 'card' | 'tile'
  if (style === 'tile') {
    return (
      <button className={'mini-tile ' + (inst.unread ? 'alert' : '')} onClick={() => onRestore(inst.id)}>
        <Icon name={app.icon} size={22} />
        <span className="mini-tile-name">{app.name}</span>
        {inst.unread > 0 && <span className="badge">{inst.unread}</span>}
        <span className="mini-x" onClick={e => { e.stopPropagation(); onClose(inst.id); }}><Icon name="close" size={13} /></span>
      </button>
    );
  }
  return (
    <div className={'mini-card ' + (inst.unread ? 'alert' : '')} onClick={() => onRestore(inst.id)}>
      <div className="mini-head">
        <span className="mini-ico"><Icon name={app.icon} size={16} /></span>
        <span className="mini-title">{app.name}</span>
        {inst.unread > 0 && <span className="badge"><Icon name="bell" size={11} />{inst.unread}</span>}
        <button className="mini-close" onClick={e => { e.stopPropagation(); onClose(inst.id); }} aria-label="Close">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="mini-body">
        <div className="mini-snap">
          {app.id === 'code' && <CodeSnap />}
          {app.id !== 'code' && <div className="snap-generic"><Icon name={app.icon} size={34} /></div>}
        </div>
        {inst.unread > 0
          ? <div className="mini-msg"><span className="cc-dot" /> {inst.msg}</div>
          : <div className="mini-msg dim">{app.tag}</div>}
      </div>
    </div>
  );
}

function CodeSnap() {
  return (
    <div className="snap-code">
      <div className="snap-lines">
        {[60, 40, 75, 30, 55, 45].map((w, i) => <span key={i} style={{ width: w + '%' }} />)}
      </div>
      <div className="snap-side">
        {[1, 2, 3, 4, 5].map(i => <span key={i} />)}
      </div>
    </div>
  );
}

function Desktop({ tweaks, greeting, onLaunch, minimized, apps, onRestore, onClose }) {
  const layout = tweaks.desktopLayout; // 'dock' | 'grid'
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div className="desktop">
      <Wallpaper mode={tweaks.wallpaper} />

      <div className="desk-stage">
        <div className="desk-hero">
          <div className="greet-time mono">{time} · {date}</div>
          <h1 className="greet">{greeting}.</h1>
          <p className="greet-sub">What should we get into? Tell me, and I'll open the right app.</p>
          <Concierge onLaunch={onLaunch} />
        </div>

        {layout === 'grid' && (
          <div className="app-grid">
            {apps.map(a => <AppTile key={a.id} app={a} onLaunch={onLaunch} variant="grid" />)}
          </div>
        )}
      </div>

      {layout === 'dock' && (
        <div className="dock">
          {apps.map(a => <AppTile key={a.id} app={a} onLaunch={onLaunch} variant="dock" />)}
        </div>
      )}

      {minimized.length > 0 && (
        <div className={'mini-stack stack-' + tweaks.previewStyle}>
          <div className="mini-stack-label mono">RUNNING · {minimized.length}</div>
          {minimized.map(inst => (
            <MiniPreview
              key={inst.id} inst={inst}
              app={apps.find(a => a.id === inst.appId)}
              style={tweaks.previewStyle}
              onRestore={onRestore} onClose={onClose}
            />
          ))}
        </div>
      )}
    </div>
  );
}

window.Desktop = Desktop;
