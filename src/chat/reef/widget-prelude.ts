/**
 * Inline script injected into reef widget iframes (not executed in the host app).
 * Placeholder __REEF_WIDGET_ID__ is replaced per mount.
 */

export const PRELUDE_SCRIPT = `(function () {
  var widgetId = "__REEF_WIDGET_ID__";
  var pending = Object.create(null);

  function post(action, extra) {
    var payload = { type: "reef", action: action, widgetId: widgetId };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k];
      }
    }
    parent.postMessage(payload, "*");
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
  };

  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(function () {
      var h = Math.ceil(document.body.getBoundingClientRect().height);
      if (h > 0) post("resize", { height: h });
    });
    ro.observe(document.body);
    post("resize", { height: Math.ceil(document.body.getBoundingClientRect().height) || 120 });
  }
})();`;

/** Replace widget id placeholder before injecting into srcdoc. */
export function injectWidgetIdIntoPrelude(prelude: string, widgetId: string): string {
  return prelude.split('__REEF_WIDGET_ID__').join(widgetId);
}
