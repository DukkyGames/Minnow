/* settings-app.jsx — recreated from screenshot 2; palette cards drive the live theme */
const { useState: useStateS } = React;

const NAV = [
  { group: 'APP', items: ['General'] },
  { group: 'MODELS & APIS', items: ['Models', 'Providers', 'Usage & cost', 'Sampler', 'Thinking'] },
  { group: 'PROMPTING & MEMORY', items: ['Prompts', 'Rules', 'Memory'] },
  { group: 'AGENTS', items: ['Modes', 'Experts', 'Work agents', 'Agent packs', 'Sub-agents'] },
  { group: 'TOOLS & INTEGRATIONS', items: ['Search', 'Deep Research', 'Servers', 'Tools', 'MCP servers', 'Language servers', 'Editor', 'Skills'] },
  { group: 'ADVANCED', items: ['Orchestration', 'Evals'] },
];

const PALETTES = [
  { id: 'sage',  name: 'Slate · Sage',     desc: 'Cool neutrals, muted sage accent. Calm and editor-like.', chips: ['#1b201e', '#222a26', '#2c352f', '#b3cf9e', '#1f2522'] },
  { id: 'amber', name: 'Stone · Amber',    desc: 'Warm taupe neutrals with an amber accent. Cozy for long sessions.', chips: ['#1c1812', '#241e16', '#2c2519', '#e6b873', '#251f17'] },
  { id: 'cyan',  name: 'Cyan · Midnight',  desc: 'Blue-tinted neutrals with a soft cyan accent. Modern dev-tool feel.', chips: ['#141c24', '#1a242d', '#202d38', '#6fd6e6', '#1a232c'] },
  { id: 'coral', name: 'Graphite · Coral', desc: 'True graphite neutrals with a warm coral accent. Distinct and soft-modern.', chips: ['#1a1716', '#221e1d', '#2a2524', '#f0a191', '#221e1e'] },
];

function SettingsApp({ tweaks, setTweak }) {
  const [active, setActive] = useStateS('General');
  const [follow, setFollow] = useStateS(false);

  return (
    <div className="settings-app">
      <div className="set-top">
        <button className="ws-btn"><Icon name="back" size={16} /></button>
        <h2 className="set-h">Settings</h2>
        <div className="set-search"><Icon name="search" size={15} /><input placeholder="Search settings…" /></div>
        <div className="set-tokens mono dim">~17.3k tokens (estimate)</div>
      </div>

      <div className="set-split">
        <nav className="set-nav">
          {NAV.map(sec => (
            <div key={sec.group} className="set-group">
              <div className="set-group-h mono">{sec.group}</div>
              {sec.items.map(it => (
                <button key={it} className={'set-item ' + (active === it ? 'on' : '')} onClick={() => setActive(it)}>{it}</button>
              ))}
            </div>
          ))}
        </nav>

        <div className="set-content">
          {active === 'General' ? (
            <div className="set-page">
              <h1>General</h1>
              <p className="set-lead">Appearance, chat behavior, and where settings are stored. Model backends live under <b>Providers</b>.</p>

              <h3 className="set-sec">Appearance</h3>
              <p className="set-muted">Palette family, light/dark mode, and follow-system behavior.</p>
              <p className="set-muted">Four palette families, each with dark and light. Preview chips use live CSS tokens.</p>

              <div className="set-row">
                <span>Follow system appearance</span>
                <button className={'toggle ' + (follow ? 'on' : '')} onClick={() => setFollow(f => !f)}><span className="knob" /></button>
              </div>

              <div className="palettes">
                {PALETTES.map(p => (
                  <button key={p.id} className={'palette ' + (tweaks.theme === p.id ? 'on' : '')} onClick={() => setTweak('theme', p.id)}>
                    <div className="palette-txt">
                      <div className="palette-name">{p.name}</div>
                      <div className="palette-desc">{p.desc}</div>
                    </div>
                    <div className="palette-chips">
                      {p.chips.map((c, i) => <span key={i} style={{ background: c }} />)}
                      {tweaks.theme === p.id && <span className="palette-check"><Icon name="check" size={15} /></span>}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mode-toggle">
                <button className={'mode-half ' + (!tweaks.light ? 'on' : '')} onClick={() => setTweak('light', false)}>Dark</button>
                <button className={'mode-half ' + (tweaks.light ? 'on' : '')} onClick={() => setTweak('light', true)}>Light</button>
              </div>

              <h3 className="set-sec mt">Chat &amp; terminal</h3>
              <p className="set-muted">How the main thread and background shells behave.</p>
              <p className="set-muted">Agent and sub-agent shell commands run in the background. The terminal panel stays closed unless you open it; the Terminal button pulses while a command is running.</p>

              <h3 className="set-sec mt">Connection summary</h3>
              <p className="set-muted">Registered LLM backends. Choose a model and provider in the top bar; edit profiles under Providers.</p>
              <div className="conn">
                <div className="conn-row"><span className="conn-k mono">ENABLED PROVIDERS</span><span className="accent">1</span></div>
                <div className="conn-row"><span className="conn-k mono">THIS CHAT'S PROVIDER</span><span>LM Studio (local) (lm-studio-local)</span></div>
                <div className="conn-row"><span className="conn-k mono">STORAGE</span><span className="mono">~/.minnow</span></div>
              </div>
              <div className="related">Related <a>Providers</a><a>Models</a><a>Tools</a></div>
            </div>
          ) : (
            <div className="set-page">
              <h1>{active}</h1>
              <p className="set-lead">This panel lives here in the full product. In this prototype, <b>{active}</b> is wired up but not fleshed out — the focus is the new OS shell and app model.</p>
              <div className="stub-card">
                <Icon name="gear" size={26} />
                <span className="mono dim">{active.toUpperCase()} · placeholder</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.SettingsApp = SettingsApp;
