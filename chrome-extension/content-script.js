"use strict";

const REQUEST_SOURCE = "x-clipper-page";
const RESPONSE_SOURCE = "x-clipper-extension";
const REQUEST_TYPE = "X_CLIPPER_CAPTURE_REQUEST";
const RESPONSE_TYPE = "X_CLIPPER_CAPTURE_RESPONSE";
const TAG_PATTERN = /^[\p{L}\p{N}_-]{1,40}$/u;
const DEFAULT_AVAILABLE_TAGS = ["research"];
const DEFAULT_CAPTURE_TAGS = ["research"];
const DEFAULT_PROMPT_TAGS_ON_CAPTURE = true;

const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const STATUS_LINK_SELECTOR = 'a[href*="/status/"]';
const USER_NAME_SELECTOR = '[data-testid="User-Name"]';

const LOOKUP_BATCH_SIZE = 120;
const LOOKUP_DEBOUNCE_MS = 700;
const POSITIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 45 * 1000;
const LOOKUP_ERROR_COOLDOWN_MS = 30 * 1000;

const MARKER_CLASS = "x-clipper-saved-marker";
const MARKER_STYLE_ID = "x-clipper-saved-marker-style";
const TAG_PICKER_STYLE_ID = "x-clipper-tag-picker-style";
const STATUS_ID_PATTERN = /\/status\/(\d{8,25})/;

const seenCache = new Map();
let lookupTimer = null;
let lookupInFlight = false;
let pendingRescan = false;
let lastLookupErrorAt = 0;

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

function splitTagInput(text) {
  return String(text || "")
    .split(/[\n, ]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadTagPickerConfig() {
  const stored = await chrome.storage.local.get({
    availableTags: DEFAULT_AVAILABLE_TAGS,
    defaultTags: DEFAULT_CAPTURE_TAGS,
    promptTagsOnCapture: DEFAULT_PROMPT_TAGS_ON_CAPTURE,
  });

  let availableTags = normalizeTags(stored.availableTags, 32);
  if (availableTags.length === 0) {
    availableTags = [...DEFAULT_AVAILABLE_TAGS];
  }

  let defaultTags = normalizeTags(stored.defaultTags, 16).filter((tag) =>
    availableTags.includes(tag)
  );
  if (defaultTags.length === 0) {
    defaultTags = [availableTags[0]];
  }

  return {
    availableTags,
    defaultTags,
    promptTagsOnCapture: Boolean(stored.promptTagsOnCapture),
  };
}

function ensureMarkerStyle() {
  if (document.getElementById(MARKER_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = MARKER_STYLE_ID;
  style.textContent = `
    .${MARKER_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: flex-start;
      margin-left: 6px;
      padding: 0 6px;
      height: 18px;
      min-width: 46px;
      width: fit-content;
      border-radius: 999px;
      border: 1px solid rgba(0, 186, 124, 0.72);
      color: rgb(0, 186, 124);
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.01em;
      text-align: center;
      vertical-align: text-top;
      pointer-events: none;
      user-select: none;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function ensureTagPickerStyle() {
  if (document.getElementById(TAG_PICKER_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = TAG_PICKER_STYLE_ID;
  style.textContent = `
    .x-clipper-tag-overlay {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.48);
      z-index: 2147483646;
      padding: 16px;
      box-sizing: border-box;
    }
    .x-clipper-tag-panel {
      width: min(540px, 100%);
      max-height: 82vh;
      overflow: auto;
      background: #111418;
      color: #e7e9ea;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 12px;
      box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
      padding: 14px;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .x-clipper-tag-title {
      font-size: 16px;
      font-weight: 700;
      margin: 0 0 8px;
    }
    .x-clipper-tag-sub {
      margin: 0 0 12px;
      font-size: 12px;
      color: #9ca6b2;
    }
    .x-clipper-tag-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .x-clipper-tag-item {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      padding: 6px 8px;
      background: rgba(255, 255, 255, 0.04);
      font-size: 12px;
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .x-clipper-tag-item:hover {
      background: rgba(255, 255, 255, 0.09);
      border-color: rgba(255, 255, 255, 0.28);
    }
    .x-clipper-tag-add-row {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
    }
    .x-clipper-tag-input {
      flex: 1;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
      color: #e7e9ea;
      padding: 7px 10px;
      font-size: 13px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .x-clipper-tag-input:focus {
      outline: none;
      border-color: rgba(0, 186, 124, 0.65);
      box-shadow: 0 0 0 2px rgba(0, 186, 124, 0.12);
    }
    .x-clipper-tag-btn {
      border: 1px solid rgba(0, 186, 124, 0.72);
      background: rgba(0, 186, 124, 0.12);
      color: #00ba7c;
      border-radius: 8px;
      padding: 7px 12px;
      font-size: 12px;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease;
    }
    .x-clipper-tag-btn:hover {
      background: rgba(0, 186, 124, 0.22);
      border-color: rgba(0, 186, 124, 0.9);
    }
    .x-clipper-tag-btn:active {
      opacity: 0.75;
    }
    .x-clipper-tag-btn:focus-visible {
      outline: 2px solid rgba(0, 186, 124, 0.65);
      outline-offset: 2px;
    }
    .x-clipper-tag-btn.secondary {
      border-color: rgba(255, 255, 255, 0.26);
      background: rgba(255, 255, 255, 0.06);
      color: #d9dde2;
    }
    .x-clipper-tag-btn.secondary:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: rgba(255, 255, 255, 0.4);
    }
    .x-clipper-tag-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 8px;
    }
    .x-clipper-tag-note {
      min-height: 16px;
      font-size: 12px;
      color: #9ca6b2;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}

function openTagPickerDialog(options) {
  ensureTagPickerStyle();
  const availableTags = normalizeTags(options && options.availableTags, 32);
  const initialSelected = normalizeTags(options && options.initialSelected, 16);

  return new Promise((resolve) => {
    const tagOrder = [...availableTags];
    const selected = new Set(initialSelected.filter((tag) => tagOrder.includes(tag)));

    const overlay = document.createElement("div");
    overlay.className = "x-clipper-tag-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const panel = document.createElement("div");
    panel.className = "x-clipper-tag-panel";
    overlay.appendChild(panel);

    const title = document.createElement("h3");
    title.className = "x-clipper-tag-title";
    title.textContent = "Select tags for this capture";
    panel.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "x-clipper-tag-sub";
    subtitle.textContent = "Choose existing tags or add new tags. Save with zero tags is also allowed.";
    panel.appendChild(subtitle);

    const list = document.createElement("div");
    list.className = "x-clipper-tag-list";
    panel.appendChild(list);

    const addRow = document.createElement("div");
    addRow.className = "x-clipper-tag-add-row";
    panel.appendChild(addRow);

    const addInput = document.createElement("input");
    addInput.className = "x-clipper-tag-input";
    addInput.placeholder = "Add tags (comma, space or newline separated)";
    addInput.setAttribute("aria-label", "Add tags");
    addRow.appendChild(addInput);

    const addButton = document.createElement("button");
    addButton.className = "x-clipper-tag-btn";
    addButton.type = "button";
    addButton.textContent = "Add";
    addRow.appendChild(addButton);

    const note = document.createElement("div");
    note.className = "x-clipper-tag-note";
    panel.appendChild(note);

    const actions = document.createElement("div");
    actions.className = "x-clipper-tag-actions";
    panel.appendChild(actions);

    const cancelButton = document.createElement("button");
    cancelButton.className = "x-clipper-tag-btn secondary";
    cancelButton.type = "button";
    cancelButton.textContent = "Cancel";
    actions.appendChild(cancelButton);

    const saveButton = document.createElement("button");
    saveButton.className = "x-clipper-tag-btn";
    saveButton.type = "button";
    saveButton.textContent = "Save";
    actions.appendChild(saveButton);

    function selectedInOrder() {
      return tagOrder.filter((tag) => selected.has(tag)).slice(0, 16);
    }

    function updateNote(message) {
      if (message) {
        note.textContent = message;
        return;
      }
      const count = selected.size;
      note.textContent = count > 0 ? `${count} tag(s) selected.` : "No tags selected.";
    }

    function renderTagList() {
      list.textContent = "";
      for (const tag of tagOrder) {
        const item = document.createElement("label");
        item.className = "x-clipper-tag-item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(tag);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            selected.add(tag);
          } else {
            selected.delete(tag);
          }
          updateNote("");
        });
        const text = document.createElement("span");
        text.textContent = tag;
        item.appendChild(checkbox);
        item.appendChild(text);
        list.appendChild(item);
      }
      updateNote("");
    }

    function addTagsFromInput() {
      const parsed = normalizeTags(splitTagInput(addInput.value), 8);
      if (parsed.length === 0) {
        updateNote("No valid tags found in input.");
        return;
      }

      let added = 0;
      for (const tag of parsed) {
        if (!tagOrder.includes(tag) && tagOrder.length < 32) {
          tagOrder.push(tag);
          added += 1;
        }
        selected.add(tag);
      }
      addInput.value = "";
      renderTagList();
      updateNote(added > 0 ? `Added ${added} tag(s).` : "Selected existing tags.");
    }

    function cleanup() {
      window.removeEventListener("keydown", onKeyDown, true);
      overlay.remove();
    }

    function finish(result) {
      cleanup();
      resolve(result);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish({ confirmed: false, tags: [] });
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        finish({ confirmed: true, tags: selectedInOrder() });
      }
    }

    addButton.addEventListener("click", addTagsFromInput);
    addInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addTagsFromInput();
      }
    });
    cancelButton.addEventListener("click", () => {
      finish({ confirmed: false, tags: [] });
    });
    saveButton.addEventListener("click", () => {
      finish({ confirmed: true, tags: selectedInOrder() });
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        finish({ confirmed: false, tags: [] });
      }
    });
    window.addEventListener("keydown", onKeyDown, true);

    renderTagList();
    document.body.appendChild(overlay);
    addInput.focus();
  });
}

async function applyCaptureTagSelection(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const config = await loadTagPickerConfig();
  const incomingTags = normalizeTags(payload.tags, 16);

  if (!config.promptTagsOnCapture) {
    if (Array.isArray(payload.tags) || payload.tags_override === true) {
      return {
        ...payload,
        tags: incomingTags,
        tags_override: true,
      };
    }
    return payload;
  }

  const picked = await openTagPickerDialog({
    availableTags: config.availableTags,
    initialSelected: incomingTags.length > 0 ? incomingTags : config.defaultTags,
  });
  if (!picked.confirmed) {
    const error = new Error("capture_cancelled");
    error.code = "capture_cancelled";
    throw error;
  }

  return {
    ...payload,
    tags: normalizeTags(picked.tags, 16),
    tags_override: true,
  };
}

function parseStatusIdFromHref(href) {
  const match = String(href || "").match(STATUS_ID_PATTERN);
  return match ? match[1] : null;
}

function extractStatusId(article) {
  if (!article) {
    return null;
  }

  const timeLink = article.querySelector('a[href*="/status/"] time');
  if (timeLink && timeLink.parentElement) {
    const fromTime = parseStatusIdFromHref(timeLink.parentElement.getAttribute("href"));
    if (fromTime) {
      return fromTime;
    }
  }

  const links = article.querySelectorAll(STATUS_LINK_SELECTOR);
  for (const link of links) {
    const href = link.getAttribute("href") || "";
    if (/\/status\/\d+\/(photo|video|analytics|quotes)/.test(href)) {
      continue;
    }
    const statusId = parseStatusIdFromHref(href);
    if (statusId) {
      return statusId;
    }
  }
  return null;
}

function collectVisibleTweetArticles() {
  const map = new Map();
  const articles = document.querySelectorAll(TWEET_SELECTOR);
  for (const article of articles) {
    const statusId = extractStatusId(article);
    if (!statusId) {
      continue;
    }
    if (!map.has(statusId)) {
      map.set(statusId, []);
    }
    map.get(statusId).push(article);
  }
  return map;
}

function isVisibleElement(node) {
  if (!node || !node.isConnected) {
    return false;
  }
  if (node.closest('[aria-hidden="true"]')) {
    return false;
  }
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  return node.getClientRects().length > 0;
}

function getMarkerHost(article) {
  const userNameNodes = article.querySelectorAll(USER_NAME_SELECTOR);
  for (const node of userNameNodes) {
    if (isVisibleElement(node)) {
      return node;
    }
  }

  const timeNode = article.querySelector("time");
  if (timeNode && timeNode.parentElement && isVisibleElement(timeNode.parentElement)) {
    return timeNode.parentElement;
  }

  const header = article.querySelector("header");
  if (isVisibleElement(header)) {
    return header;
  }

  return article;
}

function applySavedMarker(article, isSaved) {
  const existing = Array.from(article.querySelectorAll(`.${MARKER_CLASS}`));
  if (!isSaved) {
    for (const marker of existing) {
      marker.remove();
    }
    return;
  }

  const host = getMarkerHost(article);
  if (!host) {
    return;
  }

  const markerOnHost = existing.find((node) => node.parentElement === host);
  if (markerOnHost) {
    return;
  }
  for (const marker of existing) {
    marker.remove();
  }

  const marker = document.createElement("span");
  marker.className = MARKER_CLASS;
  marker.textContent = "Saved";
  marker.setAttribute("aria-label", "Saved by x-clipper");
  host.appendChild(marker);
}

function rememberStatus(statusId, saved, checkedAt) {
  if (!statusId) {
    return;
  }
  seenCache.set(statusId, {
    saved: Boolean(saved),
    checkedAt: Number.isFinite(checkedAt) ? checkedAt : Date.now(),
  });
}

function shouldLookup(statusId, now) {
  const cached = seenCache.get(statusId);
  if (!cached) {
    return true;
  }
  const ttl = cached.saved ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
  return now - cached.checkedAt > ttl;
}

function splitBatches(values, batchSize) {
  const chunks = [];
  for (let index = 0; index < values.length; index += batchSize) {
    chunks.push(values.slice(index, index + batchSize));
  }
  return chunks;
}

function collectCapturedStatusIds(payload) {
  const out = [];
  const seen = new Set();
  function pushStatusId(value) {
    const statusId = String(value || "").trim();
    if (!/^\d{8,25}$/.test(statusId)) {
      return;
    }
    if (seen.has(statusId)) {
      return;
    }
    seen.add(statusId);
    out.push(statusId);
  }

  if (payload && payload.tweet) {
    pushStatusId(payload.tweet.status_id);
  }

  const contextTweets =
    payload && Array.isArray(payload.context_tweets) ? payload.context_tweets : [];
  for (const tweet of contextTweets) {
    pushStatusId(tweet && tweet.status_id);
  }

  return out;
}

function logLookupError(error) {
  const now = Date.now();
  if (now - lastLookupErrorAt < LOOKUP_ERROR_COOLDOWN_MS) {
    return;
  }
  lastLookupErrorAt = now;
  // eslint-disable-next-line no-console
  console.warn(`[x-clipper] seen lookup failed: ${asErrorMessage(error)}`);
}

async function runSeenLookup() {
  if (lookupInFlight) {
    pendingRescan = true;
    return;
  }

  lookupInFlight = true;
  try {
    const visible = collectVisibleTweetArticles();
    if (visible.size === 0) {
      return;
    }

    const now = Date.now();
    const needLookup = [];
    for (const [statusId, articles] of visible.entries()) {
      const cached = seenCache.get(statusId);
      if (cached) {
        for (const article of articles) {
          applySavedMarker(article, cached.saved);
        }
      }
      if (shouldLookup(statusId, now)) {
        needLookup.push(statusId);
      }
    }

    if (needLookup.length === 0) {
      return;
    }

    const batches = splitBatches(needLookup, LOOKUP_BATCH_SIZE);
    for (const batch of batches) {
      let response;
      try {
        response = await chrome.runtime.sendMessage({
          type: "x_clipper_seen_lookup",
          status_ids: batch,
        });
      } catch (error) {
        logLookupError(`runtime_send_failed:${asErrorMessage(error)}`);
        return;
      }

      if (!response || !response.ok) {
        logLookupError(response && response.error ? response.error : "lookup_failed");
        return;
      }

      const statuses = response.statuses && typeof response.statuses === "object"
        ? response.statuses
        : {};
      const checkedAt = Date.now();

      for (const statusId of batch) {
        const item = statuses[statusId];
        const saved = Boolean(item && item.saved);
        rememberStatus(statusId, saved, checkedAt);
      }
    }

    const latestVisible = collectVisibleTweetArticles();
    for (const [statusId, articles] of latestVisible.entries()) {
      const cached = seenCache.get(statusId);
      const saved = Boolean(cached && cached.saved);
      for (const article of articles) {
        applySavedMarker(article, saved);
      }
    }
  } finally {
    lookupInFlight = false;
    if (pendingRescan) {
      pendingRescan = false;
      scheduleSeenLookup(150);
    }
  }
}

function scheduleSeenLookup(delayMs) {
  if (lookupTimer) {
    clearTimeout(lookupTimer);
    lookupTimer = null;
  }
  const delay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : LOOKUP_DEBOUNCE_MS;
  lookupTimer = setTimeout(() => {
    lookupTimer = null;
    runSeenLookup().catch((error) => {
      logLookupError(error);
    });
  }, delay);
}

function setupSeenMarkerObserver() {
  ensureMarkerStyle();

  const observer = new MutationObserver((mutations) => {
    let shouldRescan = false;
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
        shouldRescan = true;
        break;
      }
    }
    if (shouldRescan) {
      scheduleSeenLookup(LOOKUP_DEBOUNCE_MS);
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleSeenLookup(100);
    }
  });

  setInterval(() => {
    scheduleSeenLookup(100);
  }, NEGATIVE_CACHE_TTL_MS);

  scheduleSeenLookup(100);
}

window.addEventListener("message", async (event) => {
  if (event.source !== window) {
    return;
  }
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }
  if (data.source !== REQUEST_SOURCE || data.type !== REQUEST_TYPE) {
    return;
  }

  const requestId = data.request_id || null;
  let relayPayload = data.payload || null;
  let result;
  try {
    relayPayload = await applyCaptureTagSelection(relayPayload);
    result = await chrome.runtime.sendMessage({
      type: "x_clipper_capture_request",
      request_id: requestId,
      page_url: data.page_url || window.location.href,
      payload: relayPayload,
    });
  } catch (error) {
    const code = error && error.code ? String(error.code) : "";
    if (code === "capture_cancelled") {
      result = {
        ok: false,
        cancelled: true,
        error: "capture_cancelled",
      };
    } else {
      result = {
        ok: false,
        cancelled: false,
        error: `runtime_send_failed:${asErrorMessage(error)}`,
      };
    }
  }

  if (result && result.ok && relayPayload && typeof relayPayload === "object") {
    const savedStatusIds = collectCapturedStatusIds(relayPayload);
    const checkedAt = Date.now();
    for (const statusId of savedStatusIds) {
      rememberStatus(statusId, true, checkedAt);
    }
    if (savedStatusIds.length > 0) {
      scheduleSeenLookup(100);
    }
  }

  window.postMessage(
    {
      source: RESPONSE_SOURCE,
      type: RESPONSE_TYPE,
      request_id: requestId,
      ok: Boolean(result && result.ok),
      cancelled: Boolean(result && result.cancelled),
      error: result && result.error ? String(result.error) : null,
      transport: result && result.transport ? result.transport : null,
      tags: result && Array.isArray(result.tags) ? result.tags : null,
    },
    "*"
  );
});

setupSeenMarkerObserver();
