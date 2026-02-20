(() => {
  "use strict";

  const HOOK_KEY = "__X_CLIPPER_CAPTURE_HOOK__";
  const BRIDGE_FLAG = "__X_CLIPPER_PAGE_BRIDGE_INSTALLED__";
  const REQUEST_SOURCE = "x-clipper-page";
  const RESPONSE_SOURCE = "x-clipper-extension";
  const REQUEST_TYPE = "X_CLIPPER_CAPTURE_REQUEST";
  const RESPONSE_TYPE = "X_CLIPPER_CAPTURE_RESPONSE";
  const RESPONSE_TIMEOUT_MS = 180000;

  if (window[BRIDGE_FLAG] && typeof window[HOOK_KEY] === "function") {
    return;
  }
  window[BRIDGE_FLAG] = true;

  window[HOOK_KEY] = async function xClipperCaptureHook(input) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload = input && input.payload ? input.payload : null;

    const responsePromise = new Promise((resolve) => {
      let settled = false;
      let timeoutId = null;

      function finish(result) {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        window.removeEventListener("message", onMessage);
        resolve(result);
      }

      function onMessage(event) {
        if (event.source !== window) {
          return;
        }
        const data = event.data;
        if (!data || typeof data !== "object") {
          return;
        }
        if (data.source !== RESPONSE_SOURCE || data.type !== RESPONSE_TYPE) {
          return;
        }
        if (data.request_id !== requestId) {
          return;
        }
        finish(data);
      }

      timeoutId = window.setTimeout(() => {
        finish({
          ok: false,
          error: "extension_timeout",
        });
      }, RESPONSE_TIMEOUT_MS);

      window.addEventListener("message", onMessage);
    });

    window.postMessage(
      {
        source: REQUEST_SOURCE,
        type: REQUEST_TYPE,
        request_id: requestId,
        page_url: window.location.href,
        payload,
      },
      "*"
    );

    const response = await responsePromise;
    const ok = Boolean(response && response.ok);
    const cancelled = Boolean(response && response.cancelled);
    let error = response && response.error ? String(response.error) : null;
    if (!ok && !cancelled && !error) {
      error = "extension_no_response_payload";
    }
    return {
      ok,
      cancelled,
      skip_clipboard: ok,
      error,
      transport: response && response.transport ? response.transport : null,
      tags: response && Array.isArray(response.tags) ? response.tags : null,
    };
  };
})();
