/**
 * Static lint for reef-widget fence bodies (chart layout, JSX style tokens, Recharts wrappers).
 */

export interface ReefWidgetFenceLintResult {
  errors: string[];
  warnings: string[];
}

const TO_EXPONENTIAL_RE = /\btoExponential\s*\(/i;
const RECHARTS_IMPORT_RE = /\bfrom\s+['"]recharts['"]/;
const RECHARTS_NAME_RE = /\brecharts\b/i;
const CHART_WRAPPER_RE = /\.rw-chart\b|\.mw-chart\b/;
const YAXIS_RE = /<YAxis\b|createElement\s*\(\s*YAxis\b/;
const YAXIS_TYPE_NUMBER_RE =
  /type\s*=\s*["']number["']|type:\s*['"]number['"]|type:\s*"number"/;
const YAXIS_WIDTH_RE = /\bwidth\s*=\s*\{?\s*60\b|width:\s*60\b/;
const UNQUOTED_VAR_IN_STYLE_RE = /style=\{\{[\s\S]*?:\s*var\(--/i;
const JSX_ROOT_APP_RE = /<App\s*\/?>/;
const CREATE_ELEMENT_APP_RE = /createElement\s*\(\s*App\b/;
const LINE_OR_BAR_CHART_RE = /\b(LineChart|BarChart)\b/;
const MARGIN_LEFT_RE = /margin\s*[=:]\s*\{[^}]*\bleft\s*:\s*(\d+)/;

/** True when the fence body likely uses Recharts. */
function fenceUsesRecharts(html: string): boolean {
  return RECHARTS_IMPORT_RE.test(html) || RECHARTS_NAME_RE.test(html);
}

/** True when a cartesian Y axis is declared. */
function fenceDeclaresYAxis(html: string): boolean {
  return YAXIS_RE.test(html);
}

/**
 * Lint fence HTML before mount. Errors block mounting; warnings are for repair prompts only.
 */
export function lintReefWidgetFence(html: string): ReefWidgetFenceLintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const body = html.trim();

  if (!body) {
    return { errors: ['Widget fence is empty.'], warnings: [] };
  }

  if (UNQUOTED_VAR_IN_STYLE_RE.test(body)) {
    errors.push(
      'Quote CSS variables in React style objects (e.g. color: \'var(--mn-fg)\'), not bare var(--*).',
    );
  }

  if (JSX_ROOT_APP_RE.test(body) && !CREATE_ELEMENT_APP_RE.test(body)) {
    warnings.push('Prefer React.createElement(App) for root render in sandboxed iframes.');
  }

  const usesRecharts = fenceUsesRecharts(body);
  if (usesRecharts) {
    if (TO_EXPONENTIAL_RE.test(body)) {
      errors.push(
        'Do not use toExponential on axis ticks (collapses Y-axis width); use toFixed instead.',
      );
    }

    if (!CHART_WRAPPER_RE.test(body)) {
      errors.push('Recharts widgets must wrap the chart in an element with class rw-chart or mw-chart.');
    }

    if (fenceDeclaresYAxis(body)) {
      if (!YAXIS_TYPE_NUMBER_RE.test(body)) {
        errors.push('YAxis must set type="number" (or type: \'number\' in createElement props).');
      }
      if (!YAXIS_WIDTH_RE.test(body)) {
        errors.push('YAxis must set width={60} (or width: 60 in createElement props).');
      }
    }

    if (!/\brequestResize\b/.test(body) && !/\buseLayoutEffect\b/.test(body)) {
      warnings.push('Call window.minnow.requestResize() from useLayoutEffect after Recharts layout.');
    }

    if (LINE_OR_BAR_CHART_RE.test(body)) {
      const marginMatch = body.match(MARGIN_LEFT_RE);
      if (marginMatch) {
        const left = Number.parseInt(marginMatch[1], 10);
        if (Number.isFinite(left) && left < 36) {
          warnings.push('LineChart/BarChart margin.left should be at least 36 for Y-axis labels.');
        }
      } else {
        warnings.push('LineChart/BarChart should set margin.left to at least 36.');
      }
    }
  }

  return { errors, warnings };
}
