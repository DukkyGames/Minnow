/* chat-app.jsx — pure conversation, no repo/tools */
const { useState: useStateCh, useRef: useRefCh, useEffect: useEffectCh } = React;

function ChatApp({ seed }) {
  const [thread, setThread] = useStateCh(() => seed
    ? [{ role: 'user', text: seed }]
    : []);
  const [msg, setMsg] = useStateCh('');
  const [streaming, setStreaming] = useStateCh(false);
  const scrollRef = useRefCh(null);

  useEffectCh(() => {
    if (seed) reply();
    // eslint-disable-next-line
  }, []);

  useEffectCh(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread]);

  function reply() {
    setStreaming(true);
    const text = "Happy to talk it through. No repo loaded here — this is just you and the model, thinking out loud. Where would you like to start?";
    let i = 0;
    setThread(t => [...t, { role: 'assistant', text: '' }]);
    const iv = setInterval(() => {
      i += 2;
      setThread(t => { const c = [...t]; c[c.length - 1] = { role: 'assistant', text: text.slice(0, i) }; return c; });
      if (i >= text.length) { clearInterval(iv); setStreaming(false); }
    }, 16);
  }

  function send() {
    const q = msg.trim(); if (!q || streaming) return;
    setThread(t => [...t, { role: 'user', text: q }]); setMsg('');
    setTimeout(reply, 120);
  }

  return (
    <div className="chat-app">
      <div className="chat-top">
        <span className="chat-ava"><Icon name="fish" size={18} /></span>
        <div className="chat-title">Chat<span className="mono dim"> · Qwen3.6 27B · local</span></div>
      </div>

      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-col">
          {thread.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-ico"><Icon name="chat" size={32} /></div>
              <h3>A quiet place to think.</h3>
              <p className="dim">No files, no dev server — just conversation. Ask anything.</p>
            </div>
          )}
          {thread.map((m, i) => (
            <div key={i} className={'cmsg cmsg-' + m.role}>
              {m.role === 'assistant' && <span className="cmsg-ava"><Icon name="fish" size={15} /></span>}
              <div className="cmsg-bubble">{m.text}{streaming && i === thread.length - 1 && <span className="caret" />}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="chat-composer">
        <div className="chat-input">
          <input className="comp-field" placeholder="Message Minnow…" value={msg}
            onChange={e => setMsg(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} autoFocus />
          <button className="comp-send" onClick={send} disabled={streaming || !msg.trim()}><Icon name="arrowUp" size={18} /></button>
        </div>
      </div>
    </div>
  );
}

window.ChatApp = ChatApp;
