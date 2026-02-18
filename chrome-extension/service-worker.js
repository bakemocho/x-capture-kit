"use strict";

const DEFAULT_INGEST_URL = "http://127.0.0.1:18765/ingest";
const DEFAULT_AVAILABLE_TAGS = ["research"];
const DEFAULT_CAPTURE_TAGS = ["research"];
const DEFAULT_PROMPT_TAGS_ON_CAPTURE = true;
const PAGE_BRIDGE_FILE = "page-bridge.js";
const CLIPPER_FILE = "x-clipper.js";
const STATUS_DETAIL_PATH_PATTERN = /^\/(?:i\/web\/status|[A-Za-z0-9_]{1,20}\/status)\/\d+(?:[/?#]|$)/i;
const TAG_PATTERN = /^[\p{L}\p{N}_-]{1,40}$/u;

function isStatusDetailPage(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (!/^(x|twitter)\.com$/i.test(parsed.hostname)) {
      return false;
    }
    return STATUS_DETAIL_PATH_PATTERN.test(parsed.pathname);
  } catch (_error) {
    return false;
  }
}

function asErrorMessage(error) {
  if (!error) {
    return "unknown_error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error.message) {
    return error.message;
  }
  return String(error);
}

function normalizeStatusIds(values, limit) {
  const raw = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  const maxItems = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 200;
  for (const item of raw) {
    const statusId = String(item || "").trim();
    if (!/^\d{8,25}$/.test(statusId)) {
      continue;
    }
    if (seen.has(statusId)) {
      continue;
    }
    seen.add(statusId);
    out.push(statusId);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function normalizeLimit(value, max, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function normalizeOffset(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeTagValue(value) {
  const text = String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "_")
    .toLowerCase();
  if (!text) {
    return null;
  }
  if (!TAG_PATTERN.test(text)) {
    return null;
  }
  return text;
}

function normalizeTags(values, limit) {
  const raw = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  const maxItems = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 16;
  for (const item of raw) {
    const tag = normalizeTagValue(item);
    if (!tag) {
      continue;
    }
    if (seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    out.push(tag);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function deriveCollectorUrl(ingestUrl, pathname, query) {
  try {
    const url = new URL(String(ingestUrl || DEFAULT_INGEST_URL).trim() || DEFAULT_INGEST_URL);
    url.pathname = pathname;
    url.search = "";
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value == null || value === "") {
          continue;
        }
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  } catch (_error) {
    const fallback = new URL(DEFAULT_INGEST_URL);
    fallback.pathname = pathname;
    fallback.search = "";
    if (query && typeof query === "object") {
      for (const [key, value] of Object.entries(query)) {
        if (value == null || value === "") {
          continue;
        }
        fallback.searchParams.set(key, String(value));
      }
    }
    return fallback.toString();
  }
}

async function getRelayConfig() {
  const stored = await chrome.storage.local.get({
    ingestUrl: DEFAULT_INGEST_URL,
    ingestToken: "",
    availableTags: DEFAULT_AVAILABLE_TAGS,
    defaultTags: DEFAULT_CAPTURE_TAGS,
    promptTagsOnCapture: DEFAULT_PROMPT_TAGS_ON_CAPTURE,
  });
  const ingestUrl = String(stored.ingestUrl || DEFAULT_INGEST_URL).trim() || DEFAULT_INGEST_URL;
  const ingestToken = String(stored.ingestToken || "").trim();
  const availableTags = normalizeTags(stored.availableTags, 32);
  const defaultTags = normalizeTags(stored.defaultTags, 16);
  const defaultCaptureTags = defaultTags.filter((tag) => availableTags.includes(tag));
  return {
    ingestUrl,
    ingestToken,
    availableTags,
    defaultTags: defaultCaptureTags,
    promptTagsOnCapture: Boolean(stored.promptTagsOnCapture),
  };
}

function applyCaptureTags(payload, config) {
  const incomingTags = normalizeTags(payload && payload.tags, 16);
  const defaultTags = config && Array.isArray(config.defaultTags) ? config.defaultTags : [];
  const explicitSelection =
    Boolean(payload && payload.tags_override === true) ||
    (payload && Array.isArray(payload.tags));
  const merged = explicitSelection
    ? incomingTags
    : normalizeTags([...incomingTags, ...defaultTags], 16);
  return {
    ...payload,
    tags: merged,
    tags_override: explicitSelection,
  };
}

async function relayToCollector(message, sender) {
  const payload = message && message.payload;
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      error: "payload_missing_or_invalid",
    };
  }

  const config = await getRelayConfig();
  const envelope = {
    source: "x-clipper-extension",
    relayed_at: new Date().toISOString(),
    page_url: message.page_url || (sender.tab && sender.tab.url) || null,
    tab_id: sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null,
    payload: applyCaptureTags(payload, config),
  };
  const headers = {
    "content-type": "application/json",
  };
  if (config.ingestToken) {
    headers["x-ingest-token"] = config.ingestToken;
  }

  let response;
  try {
    response = await fetch(config.ingestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(envelope),
    });
  } catch (error) {
    return {
      ok: false,
      error: `collector_unreachable:${asErrorMessage(error)}`,
      ingest_url: config.ingestUrl,
    };
  }

  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch (_error) {
      text = "";
    }
    return {
      ok: false,
      error: `collector_http_${response.status}${text ? `:${text.slice(0, 180)}` : ""}`,
      ingest_url: config.ingestUrl,
    };
  }

  return {
    ok: true,
    transport: "extension_relay",
    ingest_url: config.ingestUrl,
    tags: envelope.payload.tags,
  };
}

async function lookupSeenStatuses(message) {
  const statusIds = normalizeStatusIds(message && message.status_ids, 200);
  if (statusIds.length === 0) {
    return {
      ok: true,
      statuses: {},
      transport: "extension_relay",
      lookup_url: null,
      queried_count: 0,
    };
  }

  const config = await getRelayConfig();
  const lookupUrl = deriveCollectorUrl(config.ingestUrl, "/lookup/seen");
  const headers = {
    "content-type": "application/json",
  };
  if (config.ingestToken) {
    headers["x-ingest-token"] = config.ingestToken;
  }

  let response;
  try {
    response = await fetch(lookupUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ status_ids: statusIds }),
    });
  } catch (error) {
    return {
      ok: false,
      error: `lookup_unreachable:${asErrorMessage(error)}`,
      lookup_url: lookupUrl,
    };
  }

  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch (_error) {
      text = "";
    }
    return {
      ok: false,
      error: `lookup_http_${response.status}${text ? `:${text.slice(0, 180)}` : ""}`,
      lookup_url: lookupUrl,
    };
  }

  let body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }

  return {
    ok: true,
    statuses: body && body.statuses && typeof body.statuses === "object" ? body.statuses : {},
    queried_count: statusIds.length,
    transport: "extension_relay",
    lookup_url: lookupUrl,
  };
}

async function listRecentCaptures(message) {
  const config = await getRelayConfig();
  const limit = normalizeLimit(message && message.limit, 200, 50);
  const offset = normalizeOffset(message && message.offset, 0);
  const includeArchived = Boolean(message && message.include_archived);
  const listUrl = deriveCollectorUrl(config.ingestUrl, "/captures/recent", {
    limit,
    offset,
    include_archived: includeArchived ? 1 : 0,
  });
  const headers = {};
  if (config.ingestToken) {
    headers["x-ingest-token"] = config.ingestToken;
  }

  let response;
  try {
    response = await fetch(listUrl, {
      method: "GET",
      headers,
    });
  } catch (error) {
    return {
      ok: false,
      error: `logs_unreachable:${asErrorMessage(error)}`,
      list_url: listUrl,
    };
  }

  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch (_error) {
      text = "";
    }
    return {
      ok: false,
      error: `logs_http_${response.status}${text ? `:${text.slice(0, 180)}` : ""}`,
      list_url: listUrl,
    };
  }

  let body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }

  return {
    ok: true,
    captures: body && Array.isArray(body.captures) ? body.captures : [],
    limit,
    offset,
    include_archived: includeArchived,
  };
}

async function updateCaptureMeta(message) {
  const captureId = Number(message && message.capture_id);
  if (!Number.isInteger(captureId) || captureId <= 0) {
    return {
      ok: false,
      error: "capture_id_invalid",
    };
  }

  const config = await getRelayConfig();
  const url = deriveCollectorUrl(config.ingestUrl, `/captures/${captureId}`);
  const headers = {
    "content-type": "application/json",
  };
  if (config.ingestToken) {
    headers["x-ingest-token"] = config.ingestToken;
  }

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(message || {}, "tags")) {
    patch.tags = normalizeTags(message.tags, 16);
  }
  if (Object.prototype.hasOwnProperty.call(message || {}, "note")) {
    patch.note = message.note == null ? null : String(message.note);
  }
  if (Object.prototype.hasOwnProperty.call(message || {}, "is_archived")) {
    patch.is_archived = Boolean(message.is_archived);
  }

  let response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify(patch),
    });
  } catch (error) {
    return {
      ok: false,
      error: `capture_update_unreachable:${asErrorMessage(error)}`,
      update_url: url,
    };
  }

  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch (_error) {
      text = "";
    }
    return {
      ok: false,
      error: `capture_update_http_${response.status}${text ? `:${text.slice(0, 180)}` : ""}`,
      update_url: url,
    };
  }

  let body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }

  return {
    ok: true,
    capture: body && body.capture ? body.capture : null,
  };
}

async function getCaptureGraph(message) {
  const captureId = Number(message && message.capture_id);
  if (!Number.isInteger(captureId) || captureId <= 0) {
    return {
      ok: false,
      error: "capture_id_invalid",
    };
  }

  const config = await getRelayConfig();
  const url = deriveCollectorUrl(config.ingestUrl, `/captures/${captureId}/graph`);
  const headers = {};
  if (config.ingestToken) {
    headers["x-ingest-token"] = config.ingestToken;
  }

  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers,
    });
  } catch (error) {
    return {
      ok: false,
      error: `capture_graph_unreachable:${asErrorMessage(error)}`,
      graph_url: url,
    };
  }

  if (!response.ok) {
    let text = "";
    try {
      text = await response.text();
    } catch (_error) {
      text = "";
    }
    return {
      ok: false,
      error: `capture_graph_http_${response.status}${text ? `:${text.slice(0, 180)}` : ""}`,
      graph_url: url,
    };
  }

  let body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }

  return {
    ok: true,
    capture: body && body.capture ? body.capture : null,
    tweets: body && Array.isArray(body.tweets) ? body.tweets : [],
    edges: body && Array.isArray(body.edges) ? body.edges : [],
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || !message.type) {
    return undefined;
  }

  if (message.type === "x_clipper_capture_request") {
    relayToCollector(message, sender)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: `collector_exception:${asErrorMessage(error)}`,
        });
      });

    return true;
  }

  if (message.type === "x_clipper_seen_lookup") {
    lookupSeenStatuses(message)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: `lookup_exception:${asErrorMessage(error)}`,
        });
      });

    return true;
  }

  if (message.type === "x_clipper_logs_list") {
    listRecentCaptures(message)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: `logs_exception:${asErrorMessage(error)}`,
        });
      });
    return true;
  }

  if (message.type === "x_clipper_capture_update") {
    updateCaptureMeta(message)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: `capture_update_exception:${asErrorMessage(error)}`,
        });
      });
    return true;
  }

  if (message.type === "x_clipper_capture_graph") {
    getCaptureGraph(message)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: `capture_graph_exception:${asErrorMessage(error)}`,
        });
      });
    return true;
  }

  return undefined;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !Number.isInteger(tab.id)) {
    return;
  }
  if (!isStatusDetailPage(tab.url)) {
    try {
      await chrome.runtime.openOptionsPage();
      // eslint-disable-next-line no-console
      console.warn(
        `[x-clipper-extension] opened options (non-status page): ${tab.url || "unknown_url"}`
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`[x-clipper-extension] failed to open options: ${asErrorMessage(error)}`);
    }
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [PAGE_BRIDGE_FILE],
      world: "MAIN",
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [CLIPPER_FILE],
      world: "MAIN",
    });
  } catch (error) {
    const message = `[x-clipper-extension] failed to run: ${asErrorMessage(error)}`;
    // eslint-disable-next-line no-console
    console.error(message);
  }
});
