/**
 * Validate and normalize HTML taken from a ```reef-widget markdown fence.
 * Rejects corrupted stream output (nested fence markers, truncated tags).
 */

const REEF_FENCE_MARKER_RE = /```reef-widget/gi;
const STRAY_CLOSING_FENCE_RE = /^```\s*$/gm;
const ANY_BACKTICK_FENCE_RE = /```/;

export interface PreparedReefWidgetHtml {
  html: string;
  /** True when repeated ```reef-widget markers were stripped from the body. */
  recoveredFromDuplicateMarkers: boolean;
}

/** Count opening vs closing tags (case-insensitive). */
function countTags(body: string, openRe: RegExp, closeRe: RegExp): { open: number; close: number } {
  return {
    open: [...body.matchAll(openRe)].length,
    close: [...body.matchAll(closeRe)].length,
  };
}

/** When the model re-emits fence markers mid-stream, keep the last HTML segment. */
function stripEmbeddedFenceMarkers(raw: string): {
  body: string;
  recoveredFromDuplicateMarkers: boolean;
} {
  if (!REEF_FENCE_MARKER_RE.test(raw)) {
    return { body: raw.trim(), recoveredFromDuplicateMarkers: false };
  }

  REEF_FENCE_MARKER_RE.lastIndex = 0;
  const segments = raw
    .split(REEF_FENCE_MARKER_RE)
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length <= 1) {
    const body = raw.replace(REEF_FENCE_MARKER_RE, '').trim();
    return { body, recoveredFromDuplicateMarkers: true };
  }

  return {
    body: segments[segments.length - 1],
    recoveredFromDuplicateMarkers: true,
  };
}

/**
 * Prepare fence body for iframe srcdoc. Returns errors when the HTML is not safe to mount.
 */
export function prepareReefWidgetHtml(
  raw: string,
): { ok: true; value: PreparedReefWidgetHtml } | { ok: false; errors: string[] } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, errors: ['Widget fence is empty.'] };
  }

  const { body: stripped, recoveredFromDuplicateMarkers } = stripEmbeddedFenceMarkers(trimmed);
  let body = stripped
    .replace(/^```reef-widget\s*\r?\n?/gim, '')
    .replace(STRAY_CLOSING_FENCE_RE, '')
    .trim();

  if (!body) {
    return { ok: false, errors: ['Widget fence is empty after removing markdown delimiters.'] };
  }

  if (ANY_BACKTICK_FENCE_RE.test(body)) {
    return {
      ok: false,
      errors: [
        'Widget body still contains markdown code-fence backticks. The assistant must emit one complete ```reef-widget block without nested fences.',
      ],
    };
  }

  const style = countTags(body, /<style\b/gi, /<\/style>/gi);
  if (style.open !== style.close) {
    return {
      ok: false,
      errors: [
        `Widget stylesheet is incomplete (${style.open} <style> open, ${style.close} </style> close). Wait for the full reply or ask for a new widget.`,
      ],
    };
  }

  const script = countTags(body, /<script\b/gi, /<\/script>/gi);
  if (script.open !== script.close) {
    return {
      ok: false,
      errors: [
        `Widget script is incomplete (${script.open} <script> open, ${script.close} </script> close). Wait for the full reply or ask for a new widget.`,
      ],
    };
  }

  if (!/<[a-z][\s\S]*?>/i.test(body)) {
    return { ok: false, errors: ['Widget body does not contain HTML markup.'] };
  }

  return {
    ok: true,
    value: { html: body, recoveredFromDuplicateMarkers },
  };
}
