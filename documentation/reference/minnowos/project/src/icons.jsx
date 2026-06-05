/* icons.jsx — clean line icon set (standard UI glyphs only) */
const { createElement: h } = React;

function Icon({ name, size = 20, stroke = 1.6, style, className }) {
  const common = {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round',
    strokeLinejoin: 'round', style, className,
  };
  const P = {
    // app: code
    code: <><path d="M8 7l-5 5 5 5" /><path d="M16 7l5 5-5 5" /><path d="M13.5 4l-3 16" /></>,
    // app: chat
    chat: <><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20.5l1.3-5.4A8 8 0 1 1 21 12Z" /></>,
    // app: research (telescope/scope)
    research: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
    // app: experts (flask)
    flask: <><path d="M9 3h6" /><path d="M10 3v6l-5 8.5A2 2 0 0 0 6.7 21h10.6a2 2 0 0 0 1.7-3.5L14 9V3" /><path d="M7.5 14h9" /></>,
    // app: benchmark (bars)
    bench: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
    // app: settings
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></>,
    // utility
    arrowRight: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
    arrowUp: <><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></>,
    back: <><path d="M19 12H5" /><path d="M11 18l-6-6 6-6" /></>,
    desktop: <><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4-4" /></>,
    mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>,
    paperclip: <><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.3 17.6a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></>,
    sliders: <><path d="M4 6h10" /><path d="M18 6h2" /><circle cx="16" cy="6" r="2" /><path d="M4 12h2" /><path d="M10 12h10" /><circle cx="8" cy="12" r="2" /><path d="M4 18h12" /><path d="M20 18h0" /><circle cx="18" cy="18" r="2" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" /></>,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>,
    refresh: <><path d="M21 12a9 9 0 1 1-2.6-6.3" /><path d="M21 4v5h-5" /></>,
    bug: <><rect x="8" y="8" width="8" height="11" rx="4" /><path d="M8 12H4M20 12h-4M8 16H4M20 16h-4M8.5 8 7 5.5M15.5 8 17 5.5M12 4v4" /></>,
    chart: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 14 3-3 3 2 4-5" /></>,
    spark: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></>,
    fish: <><path d="M16.5 12c-2 3-5.5 4.5-9 4.5 1-1.5 1-3 1-4.5s0-3-1-4.5c3.5 0 7 1.5 9 4.5Z" /><path d="M16.5 12 21 8.5v7L16.5 12Z" /><circle cx="9.5" cy="11" r=".6" fill="currentColor" stroke="none" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>,
    check: <><path d="M20 6 9 17l-5-5" /></>,
    book: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></>,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></>,
    play: <><path d="M7 4v16l13-8z" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return h('svg', common, P[name] || null);
}

window.Icon = Icon;
