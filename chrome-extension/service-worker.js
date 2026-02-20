"use strict";

const DEFAULT_INGEST_URL = "http://127.0.0.1:18765/ingest";
const DEFAULT_AVAILABLE_TAGS = ["research"];
const DEFAULT_CAPTURE_TAGS = ["research"];
const DEFAULT_PROMPT_TAGS_ON_CAPTURE = true;
const PAGE_BRIDGE_FILE = "page-bridge.js";
const CLIPPER_FILE = "x-clipper.js";
const STATUS_DETAIL_PATH_PATTERN = /^\/(?:i\/web\/status|[A-Za-z0-9_]{1,20}\/status)\/\d+(?:[/?#]|$)/i;
const TAG_PATTERN = /^[\p{L}\p{N}_-]{1,40}$/u;
const RETRY_QUEUE_STORAGE_KEY = "relayRetryQueueV1";
const MAX_RETRY_QUEUE_ITEMS = 40;
const MAX_RETRY_FLUSH_LIMIT = 100;
const DEFAULT_RETRY_FLUSH_LIMIT = 20;
const CAPTURE_REQUEST_DEDUPE_WINDOW_MS = 15 * 1000;
const CAPTURE_REQUEST_DEDUPE_MAX_KEYS = 300;

const inFlightCaptureRequests = new Map();
const recentCaptureRequestAt = new Map();

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

async function openExtensionPageInTab(pathname) {
  const runtime = typeof chrome === "object" && chrome ? chrome.runtime : null;
  const tabs = typeof chrome === "object" && chrome ? chrome.tabs : null;
  const safePath = String(pathname || "options.html").replace(/^\/+/, "");
  const pageUrl =
    runtime && typeof runtime.getURL === "function" ? runtime.getURL(safePath) : safePath;
  if (!tabs || typeof tabs.create !== "function") {
    throw new Error("tabs_create_unavailable");
  }
  await tabs.create({ url: pageUrl });
  return pageUrl;
}

async function openOptionsPageWithFallback() {
  const runtime = typeof chrome === "object" && chrome ? chrome.runtime : null;
  let runtimeOpenError = null;
  if (runtime && typeof runtime.openOptionsPage === "function") {
    try {
      await runtime.openOptionsPage();
      return { method: "runtime.openOptionsPage" };
    } catch (error) {
      runtimeOpenError = error;
    }
  }

  try {
    await openExtensionPageInTab("options.html");
    return { method: "tabs.create" };
  } catch (fallbackError) {
    if (runtimeOpenError) {
      throw new Error(
        `open_options_failed:${asErrorMessage(runtimeOpenError)};fallback_failed:${asErrorMessage(fallbackError)}`
      );
    }
    throw fallbackError;
  }
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

function buildRelayEnvelope(message, sender, config) {
  return {
    source: "x-clipper-extension",
    relayed_at: new Date().toISOString(),
    page_url: message.page_url || (sender.tab && sender.tab.url) || null,
    tab_id: sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null,
    payload: applyCaptureTags(message && message.payload, config),
  };
}

function buildCaptureRequestKey(envelope) {
  const payload = envelope && envelope.payload && typeof envelope.payload === "object"
    ? envelope.payload
    : {};
  const tweet = payload && payload.tweet && typeof payload.tweet === "object"
    ? payload.tweet
    : {};
  const statusId = String(tweet.status_id || "").trim();
  if (!/^\d{8,25}$/.test(statusId)) {
    return null;
  }
  const source = String(payload.source || envelope.source || "").trim();
  const pageUrl = String(envelope.page_url || payload.page_url || "").trim();
  const tags = normalizeTags(payload.tags, 16).slice().sort().join(",");
  return `${source}|${statusId}|${pageUrl}|${tags}`;
}

function pruneRecentCaptureRequests(now) {
  const current = Number.isFinite(now) ? now : Date.now();
  for (const [key, timestamp] of recentCaptureRequestAt.entries()) {
    if (!Number.isFinite(timestamp) || current - timestamp > CAPTURE_REQUEST_DEDUPE_WINDOW_MS) {
      recentCaptureRequestAt.delete(key);
    }
  }
  while (recentCaptureRequestAt.size > CAPTURE_REQUEST_DEDUPE_MAX_KEYS) {
    const iterator = recentCaptureRequestAt.keys().next();
    if (iterator.done) {
      break;
    }
    recentCaptureRequestAt.delete(iterator.value);
  }
}

async function postEnvelopeToCollector(envelope, config) {
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
    tags: envelope.payload && Array.isArray(envelope.payload.tags) ? envelope.payload.tags : [],
  };
}

function buildRetryDedupeKey(envelope) {
  const payload = envelope && envelope.payload && typeof envelope.payload === "object"
    ? envelope.payload
    : {};
  const tweet = payload && payload.tweet && typeof payload.tweet === "object"
    ? payload.tweet
    : {};
  const statusId = String(tweet.status_id || "");
  const capturedAt = String(payload.captured_at || "");
  const pageUrl = String(envelope && envelope.page_url ? envelope.page_url : "");
  const source = String(envelope && envelope.source ? envelope.source : "");
  return `${source}|${statusId}|${capturedAt}|${pageUrl}`;
}

function normalizeRetryQueue(rawQueue) {
  const queue = Array.isArray(rawQueue) ? rawQueue : [];
  const out = [];
  const seen = new Set();
  for (const item of queue) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (!item.envelope || typeof item.envelope !== "object") {
      continue;
    }
    const dedupeKey = String(item.dedupe_key || buildRetryDedupeKey(item.envelope));
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    out.push({
      id: String(item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      queued_at: item.queued_at || new Date().toISOString(),
      dedupe_key: dedupeKey,
      retry_count: Number.isFinite(item.retry_count) ? Number(item.retry_count) : 0,
      last_error: item.last_error ? String(item.last_error) : null,
      last_attempt_at: item.last_attempt_at ? String(item.last_attempt_at) : null,
      envelope: item.envelope,
    });
    if (out.length >= MAX_RETRY_QUEUE_ITEMS) {
      break;
    }
  }
  return out;
}

async function readRetryQueue() {
  const stored = await chrome.storage.local.get({
    [RETRY_QUEUE_STORAGE_KEY]: [],
  });
  return normalizeRetryQueue(stored[RETRY_QUEUE_STORAGE_KEY]);
}

async function writeRetryQueue(queue) {
  const normalized = normalizeRetryQueue(queue);
  await chrome.storage.local.set({
    [RETRY_QUEUE_STORAGE_KEY]: normalized.slice(0, MAX_RETRY_QUEUE_ITEMS),
  });
}

async function enqueueRetryEnvelope(envelope, errorMessage) {
  const queue = await readRetryQueue();
  const dedupeKey = buildRetryDedupeKey(envelope);
  const now = new Date().toISOString();
  const next = queue.filter((item) => item.dedupe_key !== dedupeKey);
  next.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queued_at: now,
    dedupe_key: dedupeKey,
    retry_count: 0,
    last_error: errorMessage ? String(errorMessage) : null,
    last_attempt_at: null,
    envelope,
  });

  const bounded = next.slice(0, MAX_RETRY_QUEUE_ITEMS);
  await writeRetryQueue(bounded);
  return {
    queued: true,
    retry_queue_size: bounded.length,
  };
}

function isLikelyCollectorDown(errorText) {
  const text = String(errorText || "");
  if (!text) {
    return false;
  }
  if (text.startsWith("collector_unreachable:")) {
    return true;
  }
  return /^collector_http_5\d\d/.test(text);
}

async function flushRetryQueue(message) {
  const queue = await readRetryQueue();
  const limit = normalizeLimit(message && message.limit, MAX_RETRY_FLUSH_LIMIT, DEFAULT_RETRY_FLUSH_LIMIT);
  if (queue.length === 0) {
    return {
      ok: true,
      attempted_count: 0,
      flushed_count: 0,
      failed_count: 0,
      remaining_count: 0,
      flush_limit: limit,
      queue: [],
    };
  }

  const config = await getRelayConfig();
  const remaining = [];
  let attemptedCount = 0;
  let flushedCount = 0;
  let failedCount = 0;
  let stoppedOnError = false;

  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    if (attemptedCount >= limit) {
      remaining.push(item, ...queue.slice(index + 1));
      break;
    }

    const result = await postEnvelopeToCollector(item.envelope, config);
    attemptedCount += 1;
    if (result.ok) {
      flushedCount += 1;
      continue;
    }

    failedCount += 1;
    remaining.push({
      ...item,
      retry_count: Number(item.retry_count || 0) + 1,
      last_error: result.error || "retry_failed",
      last_attempt_at: new Date().toISOString(),
    });

    if (isLikelyCollectorDown(result.error)) {
      remaining.push(...queue.slice(index + 1));
      stoppedOnError = true;
      break;
    }
  }

  await writeRetryQueue(remaining);
  return {
    ok: true,
    attempted_count: attemptedCount,
    flushed_count: flushedCount,
    failed_count: failedCount,
    remaining_count: remaining.length,
    flush_limit: limit,
    stopped_on_error: stoppedOnError,
  };
}

async function getRetryQueueStatus() {
  const queue = await readRetryQueue();
  return {
    ok: true,
    queued_count: queue.length,
    oldest_queued_at: queue.length > 0 ? queue[queue.length - 1].queued_at || null : null,
    newest_queued_at: queue.length > 0 ? queue[0].queued_at || null : null,
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
  const envelope = buildRelayEnvelope(message, sender, config);
  const dedupeKey = buildCaptureRequestKey(envelope);
  const now = Date.now();
  pruneRecentCaptureRequests(now);

  if (dedupeKey) {
    const recentAt = recentCaptureRequestAt.get(dedupeKey);
    if (Number.isFinite(recentAt) && now - recentAt < CAPTURE_REQUEST_DEDUPE_WINDOW_MS) {
      return {
        ok: true,
        deduped: true,
        transport: "extension_relay_dedupe",
        ingest_url: config.ingestUrl,
        tags: envelope.payload && Array.isArray(envelope.payload.tags) ? envelope.payload.tags : [],
      };
    }

    const inFlight = inFlightCaptureRequests.get(dedupeKey);
    if (inFlight) {
      return inFlight;
    }
  }

  const relayTask = (async () => {
    const result = await postEnvelopeToCollector(envelope, config);
    if (result.ok) {
      if (dedupeKey) {
        recentCaptureRequestAt.set(dedupeKey, Date.now());
        pruneRecentCaptureRequests(Date.now());
      }
      return result;
    }

    const queued = await enqueueRetryEnvelope(envelope, result.error || "relay_failed");
    return {
      ...result,
      ...queued,
    };
  })();

  if (dedupeKey) {
    inFlightCaptureRequests.set(dedupeKey, relayTask);
  }

  try {
    return await relayTask;
  } finally {
    if (dedupeKey) {
      inFlightCaptureRequests.delete(dedupeKey);
    }
  }
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
    capture_edges: body && Array.isArray(body.capture_edges) ? body.capture_edges : [],
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

  if (message.type === "x_clipper_retry_flush") {
    flushRetryQueue(message)
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: `retry_flush_exception:${asErrorMessage(error)}`,
        });
      });
    return true;
  }

  if (message.type === "x_clipper_retry_status") {
    getRetryQueueStatus()
      .then((result) => {
        sendResponse(result);
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: `retry_status_exception:${asErrorMessage(error)}`,
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
      const opened = await openOptionsPageWithFallback();
      // eslint-disable-next-line no-console
      console.warn(
        `[x-clipper-extension] opened options via ${opened.method} (non-status page): ${tab.url || "unknown_url"}`
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
