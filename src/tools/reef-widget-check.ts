/**
 * Off-DOM reef widget probe for the check_reef_widget tool.
 */

import { lintReefWidgetFence } from '../chat/reef/widget-fence-lint.ts';
import { prepareReefWidgetHtml } from '../chat/reef/widget-fence-body.ts';
import { buildReefWidgetSrcdoc } from '../chat/reef/widget-iframe.ts';

/** Short probe timeout for agent-side validation (ms). */
export const REEF_WIDGET_CHECK_PROBE_TIMEOUT_MS = 3500;

export interface ReefWidgetCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

interface ReefProbeMessage {
  type?: string;
  action?: string;
  widgetId?: string;
  ok?: boolean;
  errors?: string[];
  error?: string;
}

let probeCounter = 0;

function mergeUnique(lines: string[]): string[] {
  return [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
}

/**
 * Validate fence HTML: static prepare + lint, then optional iframe probe when document is available.
 */
export async function checkReefWidgetFenceHtml(html: string): Promise<ReefWidgetCheckResult> {
  const lint = lintReefWidgetFence(html);
  const prepared = prepareReefWidgetHtml(html);
  if (prepared.ok === false) {
    return {
      ok: false,
      errors: mergeUnique([...prepared.errors, ...lint.errors]),
      warnings: lint.warnings,
    };
  }

  if (lint.errors.length > 0) {
    return { ok: false, errors: lint.errors, warnings: lint.warnings };
  }

  if (typeof document === 'undefined') {
    return { ok: true, errors: [], warnings: lint.warnings };
  }

  const probe = await runOffDomWidgetProbe(prepared.value.html);
  const errors = mergeUnique(probe.errors);
  return {
    ok: probe.ok && errors.length === 0,
    errors,
    warnings: mergeUnique([...lint.warnings, ...probe.warnings]),
  };
}

/** Mount a hidden iframe and collect prelude validateResult / runtime errors. */
async function runOffDomWidgetProbe(
  widgetHtml: string,
): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
  const widgetId = `reef-check-${(probeCounter += 1)}`;
  const collected: string[] = [];

  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;';
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts');
  host.appendChild(iframe);
  document.body.appendChild(host);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      host.remove();
      resolve({
        ok: false,
        errors: mergeUnique([
          ...collected,
          'Widget validation timed out during check_reef_widget probe.',
        ]),
        warnings: [],
      });
    }, REEF_WIDGET_CHECK_PROBE_TIMEOUT_MS);

    const onMessage = (event: MessageEvent): void => {
      const data = event.data as ReefProbeMessage | null;
      if (!data || data.type !== 'reef' || data.widgetId !== widgetId) return;

      if (data.action === 'widgetError' && typeof data.error === 'string') {
        const trimmed = data.error.trim();
        if (trimmed && !collected.includes(trimmed)) collected.push(trimmed);
      }

      if (data.action !== 'validateResult') return;

      clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      host.remove();

      const runtimeErrors = Array.isArray(data.errors)
        ? data.errors.filter((e): e is string => typeof e === 'string')
        : [];
      const errors = mergeUnique([...collected, ...runtimeErrors]);
      const ok = data.ok === true && errors.length === 0;
      resolve({ ok, errors, warnings: [] });
    };

    window.addEventListener('message', onMessage);
    iframe.srcdoc = buildReefWidgetSrcdoc({ widgetHtml, widgetId });
  });
}
