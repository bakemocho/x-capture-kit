"use strict";

const DEFAULTS = {
  ingestUrl: "http://127.0.0.1:18765/ingest",
  ingestToken: "",
  availableTags: ["research"],
  defaultTags: ["research"],
  promptTagsOnCapture: true,
};

const TAG_PATTERN = /^[\p{L}\p{N}_-]{1,40}$/u;

function $(id) {
  return document.getElementById(id);
}

function splitTagText(text) {
  return String(text || "")
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
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
  const maxItems = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 32;

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

function setStatus(message, isError) {
  const node = $("statusMessage");
  node.textContent = message || "";
  node.style.color = isError ? "#ff7373" : "#9ca6b2";
}

function setRetryQueueInfo(message, isError) {
  const node = $("retryQueueInfo");
  if (!node) {
    return;
  }
  node.textContent = message || "";
  node.style.color = isError ? "#ff7373" : "#9ca6b2";
}

function deriveCollectorHealthUrl(ingestUrl) {
  try {
    const url = new URL(String(ingestUrl || DEFAULTS.ingestUrl).trim() || DEFAULTS.ingestUrl);
    url.pathname = "/healthz";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch (_error) {
    return "http://127.0.0.1:18765/healthz";
  }
}

async function openUrlInNewTab(url) {
  if (!url) {
    throw new Error("url_missing");
  }
  const tabs = typeof chrome === "object" && chrome ? chrome.tabs : null;
  if (tabs && typeof tabs.create === "function") {
    await tabs.create({ url });
    return;
  }
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    throw new Error("window_open_failed");
  }
}

async function openLogsPage() {
  const runtime = typeof chrome === "object" && chrome ? chrome.runtime : null;
  const url = runtime && typeof runtime.getURL === "function" ? runtime.getURL("logs.html") : "logs.html";
  await openUrlInNewTab(url);
}

async function openCollectorPage() {
  const ingestUrl = String($("ingestUrl").value || "").trim() || DEFAULTS.ingestUrl;
  const url = deriveCollectorHealthUrl(ingestUrl);
  await openUrlInNewTab(url);
}

async function loadRetryQueueStatus() {
  const result = await chrome.runtime.sendMessage({
    type: "x_clipper_retry_status",
  });
  if (!result || !result.ok) {
    throw new Error((result && result.error) || "retry_status_failed");
  }

  const queuedCount = Number.isFinite(result.queued_count) ? Number(result.queued_count) : 0;
  if (queuedCount === 0) {
    setRetryQueueInfo("Retry queue: empty", false);
    return;
  }
  const oldest = result.oldest_queued_at ? String(result.oldest_queued_at) : "unknown";
  setRetryQueueInfo(`Retry queue: ${queuedCount} (oldest: ${oldest})`, false);
}

function render(settings) {
  $("ingestUrl").value = settings.ingestUrl || DEFAULTS.ingestUrl;
  $("ingestToken").value = settings.ingestToken || "";
  $("availableTags").value = (settings.availableTags || []).join("\n");
  $("defaultTags").value = (settings.defaultTags || []).join(", ");
  $("promptTagsOnCapture").checked = Boolean(settings.promptTagsOnCapture);
}

async function load() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  const availableTags = normalizeTags(stored.availableTags, 32);
  const defaultTags = normalizeTags(stored.defaultTags, 16).filter((tag) =>
    availableTags.includes(tag)
  );
  render({
    ingestUrl: String(stored.ingestUrl || DEFAULTS.ingestUrl).trim() || DEFAULTS.ingestUrl,
    ingestToken: String(stored.ingestToken || ""),
    availableTags: availableTags.length > 0 ? availableTags : DEFAULTS.availableTags,
    defaultTags: defaultTags.length > 0 ? defaultTags : DEFAULTS.defaultTags,
    promptTagsOnCapture: Boolean(stored.promptTagsOnCapture),
  });
}

async function save() {
  const ingestUrl = String($("ingestUrl").value || "").trim() || DEFAULTS.ingestUrl;
  const ingestToken = String($("ingestToken").value || "").trim();
  const promptTagsOnCapture = Boolean($("promptTagsOnCapture").checked);

  let availableTags = normalizeTags(splitTagText($("availableTags").value), 32);
  let defaultTags = normalizeTags(splitTagText($("defaultTags").value), 16);

  if (availableTags.length === 0) {
    availableTags = [...DEFAULTS.availableTags];
  }
  if (defaultTags.length === 0) {
    defaultTags = [...DEFAULTS.defaultTags];
  }

  // Ensure defaults are always selectable.
  for (const tag of defaultTags) {
    if (!availableTags.includes(tag)) {
      availableTags.push(tag);
    }
  }

  await chrome.storage.local.set({
    ingestUrl,
    ingestToken,
    availableTags,
    defaultTags,
    promptTagsOnCapture,
  });

  render({ ingestUrl, ingestToken, availableTags, defaultTags, promptTagsOnCapture });
  setStatus(
    `Saved. defaultTags=${defaultTags.join(", ")} availableTags=${availableTags.length} prompt=${promptTagsOnCapture ? "on" : "off"}`,
    false
  );
}

async function resetToDefaults() {
  await chrome.storage.local.set({
    ingestUrl: DEFAULTS.ingestUrl,
    ingestToken: DEFAULTS.ingestToken,
    availableTags: DEFAULTS.availableTags,
    defaultTags: DEFAULTS.defaultTags,
    promptTagsOnCapture: DEFAULTS.promptTagsOnCapture,
  });
  render(DEFAULTS);
  setStatus("Reset to defaults.", false);
}

async function flushRetryQueue() {
  setRetryQueueInfo("Retry queue: flushing...", false);
  const result = await chrome.runtime.sendMessage({
    type: "x_clipper_retry_flush",
  });
  if (!result || !result.ok) {
    throw new Error((result && result.error) || "retry_flush_failed");
  }

  setStatus(
    `Retry flush done. attempted=${result.attempted_count || 0} flushed=${result.flushed_count || 0} failed=${result.failed_count || 0} remaining=${result.remaining_count || 0}`,
    false
  );
  await loadRetryQueueStatus();
}

window.addEventListener("DOMContentLoaded", () => {
  $("saveButton").addEventListener("click", () => {
    save().catch((error) => {
      setStatus(`Save failed: ${error && error.message ? error.message : String(error)}`, true);
    });
  });
  $("resetButton").addEventListener("click", () => {
    resetToDefaults().catch((error) => {
      setStatus(`Reset failed: ${error && error.message ? error.message : String(error)}`, true);
    });
  });
  $("flushRetryButton").addEventListener("click", () => {
    flushRetryQueue().catch((error) => {
      setStatus(`Retry flush failed: ${error && error.message ? error.message : String(error)}`, true);
      setRetryQueueInfo("Retry queue: status unknown", true);
    });
  });
  $("refreshRetryButton").addEventListener("click", () => {
    loadRetryQueueStatus().catch((error) => {
      setStatus(`Retry status failed: ${error && error.message ? error.message : String(error)}`, true);
      setRetryQueueInfo("Retry queue: status unknown", true);
    });
  });
  $("openLogsButton").addEventListener("click", () => {
    openLogsPage().catch((error) => {
      setStatus(`Open logs failed: ${error && error.message ? error.message : String(error)}`, true);
    });
  });
  $("openCollectorButton").addEventListener("click", () => {
    openCollectorPage().catch((error) => {
      setStatus(`Open collector failed: ${error && error.message ? error.message : String(error)}`, true);
    });
  });
  load().catch((error) => {
    setStatus(`Load failed: ${error && error.message ? error.message : String(error)}`, true);
  });
  loadRetryQueueStatus().catch((error) => {
    setStatus(`Retry status failed: ${error && error.message ? error.message : String(error)}`, true);
    setRetryQueueInfo("Retry queue: status unknown", true);
  });
});
