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
  load().catch((error) => {
    setStatus(`Load failed: ${error && error.message ? error.message : String(error)}`, true);
  });
});
