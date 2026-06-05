/* os.jsx — MinnowOS shell: menubar, stage, app instances, transitions */
const { useState: useStateO, useEffect: useEffectO, useRef: useRefO } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "sage",
  "light": false,
  "desktopLayout": "dock",
  "wallpaper": "underwater",
  "previewStyle": "card"
}/*EDITMODE-END*/;

function greetingFor(d) {
  const h = d.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Working late';
}

let _uid = 0;
const uid = () => 'inst-' + (++_uid);

function OS() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const { APPS } = window.MN;

  const [view, setView] = useStateO('desktop');     // 'desktop' | 'app'
  const [openApps, setOpenApps] = useStateO([]);     // [{id, appId, seed, unread, msg}]
  const [activeId, setActiveId] = useStateO(null);
  const [clock, setClock] = useStateO(() => new Date());
  const [bootDone, setBootDone] = useStateO(false);

  useEffectO(() => {
    document.documentElement.dataset.theme = tweaks.theme;
    document.documentElement.dataset.mode = tweaks.light ? 'light' : 'dark';
  }, [tweaks.theme, tweaks.light]);

  useEffectO(() => {
    const iv = setInterval(() => setClock(new Date()), 30000);
    const t = setTimeout(() => setBootDone(true), 1300);
    return () => { clearInterval(iv); clearTimeout(t); };
  }, []);

  function launch(appId, seed) {
    setOpenApps(prev => {
      const existing = prev.find(i => i.appId === appId);
      if (existing) { setActiveId(existing.id); return prev.map(i => i.id === existing.id ? { ...i, unread: 0 } : i); }
      const inst = { id: uid(), appId, seed, unread: 0, msg: '' };
      setActiveId(inst.id);
      return [...prev, inst];
    });
    setView('app');
  }
  function toDesktop() { setView('desktop'); }
  function restore(id) { setActiveId(id); setView('app'); setOpenApps(p => p.map(i => i.id === id ? { ...i, unread: 0 } : i)); }
  function closeInst(id) {
    setOpenApps(p => p.filter(i => i.id !== id));
    if (activeId === id) { setActiveId(null); setView('desktop'); }
  }
  function agentMsg(appId, msg) {
    setOpenApps(p => p.map(i => {
      if (i.appId !== appId) return i;
      const isFront = view === 'app' && activeId === i.id;
      return isFront ? i : { ...i, unread: i.unread + 1, msg };
    }));
  }

  const minimized = openApps.filter(i => i.id !== activeId || view === 'desktop');
  const totalUnread = openApps.reduce((s, i) => s + i.unread, 0);
  const activeApp = openApps.find(i => i.id === activeId);
  const activeMeta = activeApp && APPS.find(a => a.id === activeApp.appId);

  function renderApp(inst) {
    const meta = APPS.find(a => a.id === inst.appId);
    switch (inst.appId) {
      case 'code': return <CodeApp workspace="Minnow finance test" onAgentMsg={agentMsg} />;
      case 'chat': return <ChatApp seed={inst.seed} />;
      case 'research': return <ResearchApp seed={inst.seed} onAgentMsg={agentMsg} />;
      case 'experts': return <ExpertsApp />;
      case 'bench': return <BenchApp onAgentMsg={agentMsg} />;
      case 'settings': return <SettingsApp tweaks={tweaks} setTweak={setTweak} />;
      default: return null;
    }
  }

  return (
    <div className="os">
      {/* menubar */}
      <div className="menubar">
        <div className="mb-left">
          <div className="mb-logo"><Icon name="fish" size={18} /></div>
          {view === 'desktop'
            ? <span className="mb-brand">MinnowOS</span>
            : <>
                <button className="mb-desktop" onClick={toDesktop}><Icon name="grid" size={15} /> Desktop</button>
                <span className="mb-sep" />
                <span className="mb-appname"><Icon name={activeMeta?.icon} size={14} /> {activeMeta?.name}</span>
              </>
          }
        </div>
        <div className="mb-right">
          <button className="mb-chip"><span className="ws-dot ok" /> Qwen3.6 27B</button>
          <button className={'mb-bell ' + (totalUnread ? 'on' : '')} onClick={() => { const u = openApps.find(i => i.unread); if (u) restore(u.id); }}>
            <Icon name="bell" size={16} />{totalUnread > 0 && <span className="bell-badge">{totalUnread}</span>}
          </button>
          <button className="mb-icon" onClick={() => launch('settings')}><Icon name="gear" size={16} /></button>
          <span className="mb-time mono">{clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        </div>
      </div>

      {/* stage */}
      <div className={'stage ' + (view === 'app' ? 'in-app' : '')}>
        <div className="desktop-layer" style={{
          filter: view === 'app' ? 'blur(7px) brightness(.55)' : 'none',
          transform: view === 'app' ? 'scale(.965)' : 'none',
          opacity: view === 'app' ? 0.5 : 1,
          pointerEvents: view === 'app' ? 'none' : 'auto',
        }}>
          <Desktop
            tweaks={tweaks}
            greeting={greetingFor(clock)}
            onLaunch={launch}
            apps={APPS}
            minimized={minimized}
            onRestore={restore}
            onClose={closeInst}
          />
        </div>

        <div className="apps-layer">
          {openApps.map(inst => {
            const active = view === 'app' && activeId === inst.id;
            return (
            <div key={inst.id}
              className={'app-layer ' + (active ? 'is-active' : 'is-idle')}
              style={{ display: active ? 'block' : 'none', opacity: active ? 1 : 0, pointerEvents: active ? 'auto' : 'none' }}>
              {renderApp(inst)}
            </div>
          );})}
        </div>
      </div>

      {!bootDone && <BootSplash />}

      <TweaksPanel>
        <TweakSection label="Theme" />
        <TweakSelect label="Palette" value={tweaks.theme}
          options={['sage', 'amber', 'cyan', 'coral']}
          onChange={v => setTweak('theme', v)} />
        <TweakToggle label="Light mode" value={tweaks.light} onChange={v => setTweak('light', v)} />
        <TweakSection label="Desktop" />
        <TweakRadio label="Launcher" value={tweaks.desktopLayout} options={['dock', 'grid']} onChange={v => setTweak('desktopLayout', v)} />
        <TweakRadio label="Wallpaper" value={tweaks.wallpaper} options={['flat', 'gradient', 'underwater']} onChange={v => setTweak('wallpaper', v)} />
        <TweakSection label="Running apps" />
        <TweakRadio label="Preview" value={tweaks.previewStyle} options={['card', 'tile']} onChange={v => setTweak('previewStyle', v)} />
      </TweaksPanel>
    </div>
  );
}

function BootSplash() {
  return (
    <div className="boot">
      <div className="boot-logo"><Icon name="fish" size={40} /></div>
      <div className="boot-name">MinnowOS</div>
      <div className="boot-bar"><span /></div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<OS />);
