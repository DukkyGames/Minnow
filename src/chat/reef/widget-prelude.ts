/**
 * Inline script injected into reef widget iframes (not executed in the host app).
 * Placeholder __REEF_WIDGET_ID__ is replaced per mount.
 */

export const PRELUDE_SCRIPT = `(function () {
  var widgetId = "__REEF_WIDGET_ID__";
  var pending = Object.create(null);
  var resizeRaf = 0;
  var lastPostedHeight = 0;

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

  function ensureChartParentsSized() {
    var charts = document.querySelectorAll(".recharts-responsive-container");
    for (var i = 0; i < charts.length; i++) {
      var parent = charts[i].parentElement;
      if (!parent) continue;
      if (parent.getBoundingClientRect().height < 8) {
        parent.style.minHeight = "220px";
        parent.style.height = "220px";
        if (!parent.style.width) parent.style.width = "100%";
      }
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
    requestResize: scheduleResizePost,
  };

  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(function () {
      scheduleResizePost();
    });
    ro.observe(document.documentElement);
    ro.observe(document.body);
  }

  window.addEventListener("load", scheduleResizePost);

  scheduleResizePost();
})();`;

/** Replace widget id placeholder before injecting into srcdoc. */
export function injectWidgetIdIntoPrelude(prelude: string, widgetId: string): string {
  return prelude.split('__REEF_WIDGET_ID__').join(widgetId);
}
