/**
 * Compact subsystem health strip — server, tools, LSP, PTY, Electron.
 */

export type HealthComponentState = {
  ok: boolean | null;
  label: string;
  detail?: string;
  errorLink?: string;
};

export type DiagnosticsHealthPayload = {
  ok?: boolean;
  version?: string;
  platform?: string;
  nodeVersion?: string;
  electronVersion?: string | null;
  components?: {
    server?: { ok?: boolean };
    tools?: { ok?: boolean };
    memory?: { ok?: boolean };
    brain?: { ok?: boolean };
    lsp?: { ok?: boolean; running?: number };
    pty?: { ok?: boolean; sessions?: number };
    electron?: { ok?: boolean | null; available?: boolean };
  };
  lastError?: {
    signature?: string;
    message?: string;
    source?: string;
    lastAt?: string;
  } | null;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Fetch aggregated health from the diagnostics API. */
export async function fetchDiagnosticsHealth(): Promise<DiagnosticsHealthPayload | null> {
  try {
    const res = await fetch('/api/diagnostics/health', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as DiagnosticsHealthPayload;
  } catch {
    return null;
  }
}

/** Build display rows from a health payload. */
export function healthRowsFromPayload(payload: DiagnosticsHealthPayload | null): HealthComponentState[] {
  if (!payload?.components) {
    return [
      { ok: false, label: 'Server', detail: 'Unavailable' },
    ];
  }

  const c = payload.components;
  const rows: HealthComponentState[] = [
    { ok: c.server?.ok !== false, label: 'Server', detail: 'Tool server' },
    { ok: c.tools?.ok !== false, label: 'Tools', detail: 'Execution API' },
    { ok: c.memory?.ok !== false, label: 'Memory', detail: 'Recall store' },
    { ok: c.brain?.ok !== false, label: 'Brain', detail: 'Wiki store' },
    {
      ok: c.lsp?.ok !== false,
      label: 'LSP',
      detail:
        typeof c.lsp?.running === 'number' ? `${c.lsp.running} running` : undefined,
    },
    {
      ok: c.pty?.ok !== false,
      label: 'PTY',
      detail:
        typeof c.pty?.sessions === 'number' ? `${c.pty.sessions} active` : undefined,
    },
  ];

  if (c.electron?.available) {
    rows.push({
      ok: c.electron.ok,
      label: 'Electron',
      detail: 'Desktop shell',
    });
  }

  return rows;
}

/**
 * Render a horizontal health strip into `host`.
 * `onErrorClick` opens diagnostics when the user clicks last-error link.
 */
export function renderHealthStrip(
  host: HTMLElement,
  payload: DiagnosticsHealthPayload | null,
  options?: { onErrorClick?: () => void },
): void {
  host.replaceChildren();
  host.className = 'diagnostics-health-strip';

  const rows = healthRowsFromPayload(payload);
  const list = el('ul', 'diagnostics-health-strip__list');
  list.setAttribute('role', 'list');

  for (const row of rows) {
    const item = el('li', 'diagnostics-health-strip__item');
    item.setAttribute('role', 'listitem');

    const dot = el('span', 'diagnostics-health-strip__dot');
    if (row.ok === true) dot.classList.add('is-ok');
    else if (row.ok === false) dot.classList.add('is-err');
    else dot.classList.add('is-unknown');

    const label = el('span', 'diagnostics-health-strip__label', row.label);
    item.append(dot, label);
    if (row.detail) {
      item.appendChild(el('span', 'diagnostics-health-strip__detail', row.detail));
    }
    list.appendChild(item);
  }

  host.appendChild(list);

  if (payload?.lastError?.message) {
    const err = el('button', 'diagnostics-health-strip__last-error', 'Last error');
    err.type = 'button';
    err.title = payload.lastError.message;
    err.addEventListener('click', () => options?.onErrorClick?.());
    host.appendChild(err);
  }
}
