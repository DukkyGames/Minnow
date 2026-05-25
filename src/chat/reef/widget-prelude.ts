/**
 * Inline script injected into reef widget iframes (not executed in the host app).
 * Placeholder __REEF_WIDGET_ID__ is replaced per mount.
 */

export const PRELUDE_SCRIPT = `(function () {
  var widgetId = "__REEF_WIDGET_ID__";
  var pending = Object.create(null);
  var resizeRaf = 0;
  var lastPostedHeight = 0;
  var collectedErrors = [];

  function captureWidgetError(msg) {
    var s = String(msg || "Unknown error");
    if (collectedErrors.indexOf(s) >= 0) return;
    collectedErrors.push(s);
    post("widgetError", { error: s });
  }

  window.addEventListener("error", function (ev) {
    captureWidgetError(ev.message || (ev.error && ev.error.message) || "Script error");
  });

  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev.reason;
    captureWidgetError((r && r.message) || String(r || "Unhandled rejection"));
  });

  function emitValidateResult() {
    post("validateResult", { ok: collectedErrors.length === 0, errors: collectedErrors.slice() });
  }

  function post(action, extra) {
    var payload = { type: "reef", action: action, widgetId: widgetId };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      }
    }
    parent.postMessage(payload, "*");
  }

  function measureContentHeightPx() {
    var root = document.documentElement;
    var body = document.body;
    var fromBody = body
      ? Math.max(body.scrollHeight, body.offsetHeight, Math.ceil(body.getBoundingClientRect().height))
      : 0;
    var fromRoot = Math.max(root.scrollHeight, root.offsetHeight, Math.ceil(root.getBoundingClientRect().height));
    return Math.ceil(Math.max(fromBody, fromRoot, 1));
  }

  function postResizeToHost() {
    var h = measureContentHeightPx();
    if (h <= 0) return;
    if (h === lastPostedHeight) return;
    lastPostedHeight = h;
    post("resize", { height: h });
  }

  function sizeChartWrapper(el) {
    if (!el || !el.getBoundingClientRect) return;
    if (el.getBoundingClientRect().height < 8) {
      el.style.minHeight = "220px";
      el.style.height = "220px";
      if (!el.style.width) el.style.width = "100%";
    }
  }

  function ensureChartParentsSized() {
    var wrappers = document.querySelectorAll(".rw-chart, .mw-chart");
    for (var w = 0; w < wrappers.length; w++) sizeChartWrapper(wrappers[w]);
    var charts = document.querySelectorAll(".recharts-responsive-container");
    for (var i = 0; i < charts.length; i++) {
      var parent = charts[i].parentElement;
      if (parent) sizeChartWrapper(parent);
    }
  }

  function scheduleResizePost() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(function () {
      resizeRaf = requestAnimationFrame(function () {
        resizeRaf = 0;
        ensureChartParentsSized();
        postResizeToHost();
      });
    });
  }

  var validateEmitted = false;

  function emitValidateResultOnce() {
    if (validateEmitted) return;
    validateEmitted = true;
    emitValidateResult();
  }

  function probeChartLayout() {
    var containers = document.querySelectorAll(".recharts-responsive-container");
    if (!containers.length) return;
    for (var c = 0; c < containers.length; c++) {
      var rect = containers[c].getBoundingClientRect();
      if (rect.height < 48) {
        captureWidgetError("Chart did not lay out (responsive container height too small)");
        break;
      }
    }
    var ticks = document.querySelectorAll(".recharts-cartesian-axis-tick text, .recharts-cartesian-axis-tick tspan");
    for (var t = 0; t < ticks.length; t++) {
      var label = (ticks[t].textContent || "").trim();
      if (/e[+-]?\\d+/i.test(label)) {
        captureWidgetError("Chart axis uses scientific notation; use toFixed on tickFormatter instead of toExponential");
        break;
      }
    }
  }

  function tryEmitValidateAfterResize() {
    if (validateEmitted) return;
    postResizeToHost();
    ensureChartParentsSized();
    probeChartLayout();
    if (lastPostedHeight >= 24) {
      emitValidateResultOnce();
      return;
    }
    setTimeout(function () {
      postResizeToHost();
      ensureChartParentsSized();
      probeChartLayout();
      emitValidateResultOnce();
    }, 80);
  }

  /** Catch dynamic DOM (sync scripts, ESM, charts) that mount after the first measure. */
  function scheduleDelayedResizePasses() {
    var hasJsx = document.querySelector('script[type="text/jsx"]') != null;
    var validateDelayMs = hasJsx ? 2800 : 600;

    /* Sync measure first: rAF can lag while the host probes with a hidden iframe. */
    postResizeToHost();
    scheduleResizePost();
    setTimeout(scheduleResizePost, 0);
    setTimeout(postResizeToHost, 0);
    setTimeout(scheduleResizePost, 100);
    setTimeout(scheduleResizePost, 400);
    if (hasJsx) {
      setTimeout(scheduleResizePost, 1200);
      setTimeout(scheduleResizePost, 2200);
    }
    setTimeout(tryEmitValidateAfterResize, validateDelayMs);
    setTimeout(emitValidateResultOnce, hasJsx ? 4200 : 1800);
  }

  window.addEventListener("message", function (ev) {
    var d = ev.data;
    if (!d || d.type !== "reef" || d.widgetId !== widgetId) return;
    if (d.action === "llmChunk" || d.action === "llmDone" || d.action === "llmError") {
      var req = pending[d.requestId];
      if (!req) return;
      if (d.action === "llmChunk" && typeof d.delta === "string") {
        req.text += d.delta;
        if (req.onChunk) req.onChunk(d.delta, req.text);
      }
      if (d.action === "llmDone") {
        delete pending[d.requestId];
        req.resolve(req.text);
      }
      if (d.action === "llmError") {
        delete pending[d.requestId];
        req.reject(new Error(typeof d.error === "string" ? d.error : "LLM request failed"));
      }
    }
  });

  window.minnow = {
    sendPrompt: function (text) {
      post("sendPrompt", { text: String(text == null ? "" : text) });
    },
    callLLM: function (opts) {
      opts = opts || {};
      var requestId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
      var messages = Array.isArray(opts.messages) ? opts.messages : [];
      return new Promise(function (resolve, reject) {
        pending[requestId] = { resolve: resolve, reject: reject, text: "", onChunk: opts.onChunk };
        post("callLLM", {
          requestId: requestId,
          messages: messages,
          model: opts.model != null ? String(opts.model) : undefined,
        });
      });
    },
    openLink: function (url) {
      post("openLink", { url: String(url == null ? "" : url) });
    },
    editArtifact: function (opts) {
      opts = opts || {};
      post("editArtifact", {
        artifactId: String(opts.artifactId || ""),
        content: opts.content != null ? String(opts.content) : undefined,
        summary: opts.summary != null ? String(opts.summary) : undefined,
      });
    },
    requestResize: scheduleResizePost,
  };

  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(function () {
      scheduleResizePost();
    });
    ro.observe(document.documentElement);
    ro.observe(document.body);
  }

  if (typeof MutationObserver !== "undefined" && document.body) {
    var chartMo = new MutationObserver(function () {
      scheduleResizePost();
    });
    chartMo.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener("load", scheduleDelayedResizePasses);

  scheduleDelayedResizePasses();
})();`;

/** Replace widget id placeholder before injecting into srcdoc. */
export function injectWidgetIdIntoPrelude(prelude: string, widgetId: string): string {
  return prelude.split('__REEF_WIDGET_ID__').join(widgetId);
}
