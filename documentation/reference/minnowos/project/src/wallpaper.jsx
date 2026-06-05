/* wallpaper.jsx — ambient desktop backgrounds */
const { useEffect: useEffectW, useRef: useRefW, useMemo: useMemoW } = React;

function Wallpaper({ mode }) {
  // mode: 'flat' | 'gradient' | 'underwater'
  const bubbles = useMemoW(() =>
    Array.from({ length: 16 }, (_, i) => ({
      left: Math.random() * 100,
      size: 3 + Math.random() * 10,
      dur: 14 + Math.random() * 22,
      delay: -Math.random() * 30,
      drift: (Math.random() * 2 - 1) * 40,
      op: 0.05 + Math.random() * 0.12,
    })), []);

  return (
    <div className={'wall wall-' + mode} aria-hidden="true">
      {mode !== 'flat' && <div className="wall-glow" />}
      {mode === 'underwater' && <>
        <div className="caustic caustic-a" />
        <div className="caustic caustic-b" />
        <div className="bubbles">
          {bubbles.map((b, i) => (
            <span key={i} style={{
              left: b.left + '%', width: b.size, height: b.size,
              opacity: b.op, animationDuration: b.dur + 's',
              animationDelay: b.delay + 's', '--drift': b.drift + 'px',
            }} />
          ))}
        </div>
        <div className="vignette" />
      </>}
    </div>
  );
}

window.Wallpaper = Wallpaper;
