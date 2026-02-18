"use strict";

const DEFAULT_PAGE_SIZE = 50;
const TAG_PATTERN = /^[\p{L}\p{N}_-]{1,40}$/u;
const MAX_TEXT_PREVIEW = 220;
const MAX_KNOWN_TAGS = 64;

const RELATION_LABELS = {
  reply_to: "-> reply",
  quotes_tweet: "=> quote_tweet",
  quotes_article: "=> quote_article",
  context_relation: "<-> context",
  related_self: "~> related_self",
};

const EDGE_ARROWS = {
  reply_to: "->",
  quotes_tweet: "=>",
  quotes_article: "=>",
  context_relation: "<->",
  related_self: "~>",
};

const state = {
  includeArchived: false,
  offset: 0,
  captures: [],
  hasMore: false,
  loading: false,
  knownTags: [],
};

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, isError) {
  const node = $("statusMessage");
  node.textContent = message || "";
  node.style.color = isError ? "#ff7373" : "#9ca6b2";
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response || {});
      });
    } catch (error) {
      reject(error);
    }
  });
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

function splitTagInput(text) {
  return String(text || "")
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readTagInputContext(text) {
  const raw = String(text || "");
  const lastCommaIndex = raw.lastIndexOf(",");
  const beforeCurrent = lastCommaIndex >= 0 ? raw.slice(0, lastCommaIndex + 1) : "";
  const currentRaw = lastCommaIndex >= 0 ? raw.slice(lastCommaIndex + 1) : raw;
  const committedTags = normalizeTags(splitTagInput(beforeCurrent), 16);
  return {
    committedTags,
    currentRaw,
    currentNormalized: normalizeTagValue(currentRaw),
  };
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

function formatDateTime(isoString) {
  if (!isoString) {
    return "-";
  }
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) {
    return String(isoString);
  }
  return date.toLocaleString();
}

function normalizeStatusUrl(capture) {
  if (capture && typeof capture.canonical_url === "string" && capture.canonical_url.trim()) {
    return capture.canonical_url;
  }
  if (capture && typeof capture.page_url === "string" && capture.page_url.trim()) {
    return capture.page_url;
  }
  if (capture && capture.primary_status_id) {
    return `https://x.com/i/web/status/${capture.primary_status_id}`;
  }
  return null;
}

function formatCount(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Number(value).toLocaleString();
}

function compactText(text, maxLength) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) {
    return "";
  }
  if (raw.length <= maxLength) {
    return raw;
  }
  return `${raw.slice(0, maxLength - 1)}…`;
}

function readPrimaryTweet(capture) {
  const primary = capture && capture.primary_tweet && typeof capture.primary_tweet === "object"
    ? capture.primary_tweet
    : {};
  const author = primary.author && typeof primary.author === "object" ? primary.author : {};
  return {
    status_id: primary.status_id || capture.primary_status_id || null,
    status_url: primary.status_url || null,
    author: {
      handle: author.handle || null,
      handle_text: author.handle_text || (author.handle ? `@${author.handle}` : null),
      display_name: author.display_name || null,
    },
    text: primary.text || null,
    metrics: primary.metrics && typeof primary.metrics === "object" ? primary.metrics : {},
  };
}

function readEdgeCounts(capture) {
  const counts = capture && capture.edge_counts && typeof capture.edge_counts === "object"
    ? capture.edge_counts
    : {};
  return {
    total: Number.isFinite(counts.total) ? Number(counts.total) : 0,
    reply_to: Number.isFinite(counts.reply_to) ? Number(counts.reply_to) : 0,
    quotes_tweet: Number.isFinite(counts.quotes_tweet) ? Number(counts.quotes_tweet) : 0,
    quotes_article: Number.isFinite(counts.quotes_article) ? Number(counts.quotes_article) : 0,
    context_relation: Number.isFinite(counts.context_relation) ? Number(counts.context_relation) : 0,
    related_self: Number.isFinite(counts.related_self) ? Number(counts.related_self) : 0,
  };
}

function mergeKnownTags(rawTags) {
  const incoming = normalizeTags(rawTags, MAX_KNOWN_TAGS);
  const merged = normalizeTags([...(state.knownTags || []), ...incoming], MAX_KNOWN_TAGS);
  state.knownTags = merged;
}

async function loadKnownTagsFromOptions() {
  let stored;
  try {
    stored = await chrome.storage.local.get({
      availableTags: [],
      defaultTags: [],
    });
  } catch (_error) {
    stored = {
      availableTags: [],
      defaultTags: [],
    };
  }
  mergeKnownTags([...(stored.availableTags || []), ...(stored.defaultTags || [])]);
}

function mergeKnownTagsFromCaptures(captures) {
  const tags = [];
  for (const capture of Array.isArray(captures) ? captures : []) {
    if (capture && Array.isArray(capture.tags)) {
      tags.push(...capture.tags);
    }
  }
  mergeKnownTags(tags);
}

function formatTweetLabel(tweet) {
  const author = tweet && tweet.author && typeof tweet.author === "object" ? tweet.author : {};
  const display = author.display_name || author.handle_text || author.handle || "unknown";
  const statusId = String(tweet && tweet.status_id ? tweet.status_id : "");
  if (!statusId) {
    return display;
  }
  return `${display} #${statusId.slice(-6)}`;
}

function formatStatusIdLabel(statusId, tweetsById) {
  if (!statusId) {
    return "(none)";
  }
  const tweet = tweetsById.get(String(statusId));
  if (!tweet) {
    return `status:${statusId.slice(-6)}`;
  }
  return formatTweetLabel(tweet);
}

function createMetricPillRow(metrics) {
  const row = document.createElement("div");
  row.className = "pill-row";
  const metricMap = [
    ["replies", "replies"],
    ["reposts", "reposts"],
    ["likes", "likes"],
    ["bookmarks", "bookmarks"],
    ["views", "views"],
  ];
  for (const [key, label] of metricMap) {
    const value = Number(metrics && metrics[key]);
    if (!Number.isFinite(value)) {
      continue;
    }
    const pill = document.createElement("span");
    pill.className = "pill metric";
    pill.textContent = `${label}:${formatCount(value)}`;
    row.append(pill);
  }
  return row;
}

function sortTweetIdsForTimeline(ids, tweetsById) {
  return [...ids].sort((left, right) => {
    const leftTweet = tweetsById.get(String(left)) || {};
    const rightTweet = tweetsById.get(String(right)) || {};
    const leftTime = Date.parse(leftTweet.posted_at || "");
    const rightTime = Date.parse(rightTweet.posted_at || "");
    const leftHasTime = Number.isFinite(leftTime);
    const rightHasTime = Number.isFinite(rightTime);
    if (leftHasTime && rightHasTime && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    if (leftHasTime && !rightHasTime) {
      return -1;
    }
    if (!leftHasTime && rightHasTime) {
      return 1;
    }
    return String(left).localeCompare(String(right));
  });
}

function renderTimelineConnectorsForTimeline(timeline) {
  if (!timeline) {
    return;
  }

  const existing = timeline.querySelector("svg.timeline-overlay");
  if (existing) {
    existing.remove();
  }

  const items = Array.from(timeline.querySelectorAll(".timeline-item[data-status-id]"));
  if (items.length === 0) {
    return;
  }

  const byStatusId = new Map();
  for (const item of items) {
    const statusId = String(item.dataset.statusId || "");
    if (statusId) {
      byStatusId.set(statusId, item);
    }
  }

  const width = Math.max(1, timeline.clientWidth);
  const height = Math.max(1, timeline.scrollHeight);
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.classList.add("timeline-overlay");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("preserveAspectRatio", "none");

  function buildElbowPath(startX, startY, endX, endY) {
    const xDelta = endX - startX;
    const yDelta = endY - startY;
    if (!Number.isFinite(xDelta) || !Number.isFinite(yDelta)) {
      return null;
    }
    if (Math.abs(xDelta) < 0.5) {
      return `M ${startX} ${startY} V ${endY}`;
    }

    const absX = Math.abs(xDelta);
    const absY = Math.abs(yDelta);
    // Corner radius proportional to both spans — prevents horizontal overshoot.
    const cornerR = Math.max(2, Math.min(10, absX * 0.4, absY * 0.4));

    const dir = xDelta > 0 ? 1 : -1;
    const yDir = yDelta >= 0 ? 1 : -1;
    const bendY = endY - yDir * cornerR;
    const curveEndX = startX + dir * cornerR;

    return `M ${startX} ${startY} V ${bendY} Q ${startX} ${endY} ${curveEndX} ${endY} H ${endX}`;
  }

  function addConnectorPath(startItem, endItem, pathClass) {
    if (!startItem || !endItem) {
      return;
    }
    // .timeline-node: left:2px, top:14px, 8×8px → center at (item.offsetLeft+6, item.offsetTop+18)
    const startX = startItem.offsetLeft + 6;
    const startY = startItem.offsetTop + startItem.offsetHeight;
    const endX = endItem.offsetLeft + 6;
    const endY = endItem.offsetTop + 18;
    const pathData = buildElbowPath(startX, startY, endX, endY);
    if (!pathData) {
      return;
    }
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathData);
    path.classList.add("timeline-path", pathClass);
    svg.append(path);
  }

  for (const child of items) {
    const parentId = String(child.dataset.parentStatusId || "");
    if (!parentId) {
      continue;
    }
    const parent = byStatusId.get(parentId);
    if (!parent) {
      continue;
    }
    addConnectorPath(parent, child, "timeline-path-reply");
  }

  const graphEdges = Array.isArray(timeline.__graphEdges) ? timeline.__graphEdges : [];
  for (const edge of graphEdges) {
    if (!edge || edge.edge_type !== "quotes_tweet") {
      continue;
    }
    const srcId = String(edge.src_status_id || "");
    const dstId = String(edge.dst_status_id || "");
    if (!srcId || !dstId) {
      continue;
    }
    const srcItem = byStatusId.get(srcId);
    const dstItem = byStatusId.get(dstId);
    if (!srcItem || !dstItem) {
      continue;
    }
    if (srcItem === dstItem) {
      continue;
    }
    if (srcItem.offsetTop <= dstItem.offsetTop) {
      addConnectorPath(srcItem, dstItem, "timeline-path-quote");
    } else {
      addConnectorPath(dstItem, srcItem, "timeline-path-quote");
    }
  }

  timeline.prepend(svg);
}

function renderTimelineConnectors(root) {
  if (!root) {
    return;
  }
  const timelines = root.querySelectorAll(".timeline");
  for (const timeline of timelines) {
    renderTimelineConnectorsForTimeline(timeline);
  }
}

function compactUrlLabel(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "(external)";
  }
  try {
    const parsed = new URL(text);
    const label = `${parsed.hostname}${parsed.pathname || ""}`;
    return compactText(label, 48);
  } catch (_error) {
    return compactText(text, 48);
  }
}

function collectNonReplyEdgesBySource(edges, tweetsById) {
  const map = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || edge.edge_type === "reply_to") {
      continue;
    }
    const src = String(edge.src_status_id || "");
    if (!src || !tweetsById.has(src)) {
      continue;
    }
    const list = map.get(src) || [];
    list.push(edge);
    map.set(src, list);
  }
  return map;
}

function getEdgeTypeOrder(edgeType) {
  switch (edgeType) {
    case "quotes_tweet":
      return 1;
    case "quotes_article":
      return 2;
    case "context_relation":
      return 3;
    case "related_self":
      return 4;
    default:
      return 9;
  }
}

function formatEdgeTargetLabel(edge, tweetsById) {
  if (edge && edge.dst_status_id) {
    return formatStatusIdLabel(edge.dst_status_id, tweetsById);
  }
  if (edge && edge.dst_url) {
    return compactUrlLabel(edge.dst_url);
  }
  return "(external)";
}

function relationToneClass(edgeType) {
  switch (edgeType) {
    case "quotes_tweet":
      return "tone-quote-tweet";
    case "quotes_article":
      return "tone-quote-article";
    case "context_relation":
      return "tone-context";
    case "related_self":
      return "tone-related-self";
    default:
      return "tone-default";
  }
}

function optimizeTimelineOrder(initialOrder, parentByChild, spanEdges, pinnedFirstStatusId) {
  const order = Array.isArray(initialOrder) ? [...initialOrder] : [];
  if (order.length <= 1) {
    return order;
  }

  const hasPin = Boolean(pinnedFirstStatusId);

  function buildIndexMap(sequence) {
    const map = new Map();
    sequence.forEach((statusId, index) => {
      map.set(String(statusId), index);
    });
    return map;
  }

  function isOrderValid(sequence) {
    if (hasPin && sequence[0] !== pinnedFirstStatusId) {
      return false;
    }
    const indexByStatusId = buildIndexMap(sequence);
    for (const [child, parent] of parentByChild.entries()) {
      const childIndex = indexByStatusId.get(String(child));
      const parentIndex = indexByStatusId.get(String(parent));
      if (!Number.isFinite(childIndex) || !Number.isFinite(parentIndex)) {
        continue;
      }
      if (childIndex <= parentIndex) {
        return false;
      }
    }
    return true;
  }

  function computeCrossingCost(sequence) {
    const indexByStatusId = buildIndexMap(sequence);
    let total = 0;
    for (const edge of spanEdges) {
      const leftIndex = indexByStatusId.get(String(edge.left));
      const rightIndex = indexByStatusId.get(String(edge.right));
      if (!Number.isFinite(leftIndex) || !Number.isFinite(rightIndex)) {
        continue;
      }
      const span = Math.abs(leftIndex - rightIndex) - 1;
      if (span <= 0) {
        continue;
      }
      total += span * (Number(edge.weight) || 1);
    }
    return total;
  }

  let current = [...order];
  let currentCost = computeCrossingCost(current);
  let improved = true;
  let passCount = 0;
  const maxPasses = Math.max(12, current.length * 2);

  while (improved && passCount < maxPasses) {
    passCount += 1;
    improved = false;
    const startIndex = hasPin ? 1 : 0;
    for (let index = startIndex; index < current.length - 1; index += 1) {
      const candidate = [...current];
      const left = candidate[index];
      candidate[index] = candidate[index + 1];
      candidate[index + 1] = left;

      if (!isOrderValid(candidate)) {
        continue;
      }
      const candidateCost = computeCrossingCost(candidate);
      if (candidateCost < currentCost) {
        current = candidate;
        currentCost = candidateCost;
        improved = true;
      }
    }
  }

  return current;
}

function buildReplyTimelineRows(tweetsById, edges, primaryStatusId) {
  const replyParentByChild = new Map();
  const quoteTargetsBySource = new Map();
  const quoteSourcesByTarget = new Map();

  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge) {
      continue;
    }

    if (edge.edge_type === "reply_to") {
      const child = String(edge.src_status_id || "");
      const parent = String(edge.dst_status_id || "");
      if (!child || !parent || child === parent) {
        continue;
      }
      if (!tweetsById.has(child) || !tweetsById.has(parent)) {
        continue;
      }
      if (replyParentByChild.has(child)) {
        continue;
      }
      replyParentByChild.set(child, parent);
      continue;
    }

    if (edge.edge_type === "quotes_tweet") {
      const source = String(edge.src_status_id || "");
      const target = String(edge.dst_status_id || "");
      if (!source || !target || source === target) {
        continue;
      }
      if (!tweetsById.has(source) || !tweetsById.has(target)) {
        continue;
      }
      const targets = quoteTargetsBySource.get(source) || [];
      if (!targets.includes(target)) {
        targets.push(target);
      }
      quoteTargetsBySource.set(source, targets);

      const sources = quoteSourcesByTarget.get(target) || [];
      if (!sources.includes(source)) {
        sources.push(source);
      }
      quoteSourcesByTarget.set(target, sources);
    }
  }

  const childrenByParent = new Map();
  for (const [child, parent] of replyParentByChild.entries()) {
    const children = childrenByParent.get(parent) || [];
    children.push(child);
    childrenByParent.set(parent, children);
  }

  for (const [parent, children] of childrenByParent.entries()) {
    childrenByParent.set(parent, sortTweetIdsForTimeline(children, tweetsById));
  }

  const allTweetIds = sortTweetIdsForTimeline(Array.from(tweetsById.keys()), tweetsById);
  const roots = [];
  for (const statusId of allTweetIds) {
    const parent = replyParentByChild.get(statusId);
    if (!parent || !tweetsById.has(parent)) {
      roots.push(statusId);
    }
  }

  if (primaryStatusId && tweetsById.has(primaryStatusId)) {
    let top = String(primaryStatusId);
    const seen = new Set([top]);
    while (replyParentByChild.has(top)) {
      const parent = replyParentByChild.get(top);
      if (!parent || seen.has(parent)) {
        break;
      }
      seen.add(parent);
      top = parent;
    }
    const rootIndex = roots.indexOf(top);
    if (rootIndex > 0) {
      roots.splice(rootIndex, 1);
      roots.unshift(top);
    }
  }

  const initialOrder = [];
  const visited = new Set();

  function visit(statusId) {
    if (!statusId || visited.has(statusId)) {
      return;
    }
    visited.add(statusId);
    const tweet = tweetsById.get(statusId);
    if (!tweet) {
      return;
    }
    initialOrder.push(statusId);

    const children = childrenByParent.get(statusId) || [];
    for (const child of children) {
      visit(child);
    }
  }

  for (const root of roots) {
    visit(root);
  }

  for (const orphanId of allTweetIds) {
    if (visited.has(orphanId)) {
      continue;
    }
    visit(orphanId);
  }

  const spanEdges = [];
  const seenSpanEdges = new Set();
  function addSpanEdge(left, right, weight) {
    const leftId = String(left || "");
    const rightId = String(right || "");
    if (!leftId || !rightId || leftId === rightId) {
      return;
    }
    if (!tweetsById.has(leftId) || !tweetsById.has(rightId)) {
      return;
    }
    const key = leftId < rightId ? `${leftId}|${rightId}` : `${rightId}|${leftId}`;
    if (seenSpanEdges.has(key)) {
      return;
    }
    seenSpanEdges.add(key);
    spanEdges.push({ left: leftId, right: rightId, weight: Number(weight) || 1 });
  }

  for (const [child, parent] of replyParentByChild.entries()) {
    addSpanEdge(child, parent, 2);
  }
  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || edge.edge_type !== "quotes_tweet") {
      continue;
    }
    addSpanEdge(edge.src_status_id, edge.dst_status_id, 1);
  }

  const pinnedFirstStatusId = initialOrder.length > 0 ? initialOrder[0] : null;
  const optimizedOrder = optimizeTimelineOrder(
    initialOrder,
    replyParentByChild,
    spanEdges,
    pinnedFirstStatusId
  );

  function collectReplySubtree(rootStatusId) {
    const root = String(rootStatusId || "");
    const members = new Set();
    if (!root) {
      return members;
    }
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || members.has(current)) {
        continue;
      }
      members.add(current);
      const children = childrenByParent.get(current) || [];
      for (const child of children) {
        stack.push(child);
      }
    }
    return members;
  }

  function enforceQuoteAdjacency(sequence) {
    const order = Array.isArray(sequence) ? [...sequence] : [];
    const movedTargets = new Set();
    const sourcesInOrder = order.filter((statusId) => quoteTargetsBySource.has(statusId));

    for (const sourceId of sourcesInOrder) {
      const sourceTargets = (quoteTargetsBySource.get(sourceId) || []).filter((targetId) =>
        order.includes(targetId)
      );
      if (sourceTargets.length === 0) {
        continue;
      }

      let sourceIndex = order.indexOf(sourceId);
      if (sourceIndex < 0) {
        continue;
      }
      let insertAt = sourceIndex + 1;

      for (const targetId of sourceTargets) {
        if (targetId === sourceId || movedTargets.has(targetId)) {
          continue;
        }
        const targetIndex = order.indexOf(targetId);
        if (targetIndex < 0) {
          continue;
        }

        const subtreeMembers = collectReplySubtree(targetId);
        if (subtreeMembers.has(sourceId)) {
          continue;
        }
        const moveBlock = order.filter((statusId) => subtreeMembers.has(statusId));
        if (moveBlock.length === 0) {
          continue;
        }

        const remaining = order.filter((statusId) => !subtreeMembers.has(statusId));
        const remainingSourceIndex = remaining.indexOf(sourceId);
        if (remainingSourceIndex < 0) {
          continue;
        }

        let targetInsertAt = remainingSourceIndex + 1;
        if (targetInsertAt < insertAt) {
          targetInsertAt = insertAt;
        }
        const replyParent = replyParentByChild.get(targetId) || null;
        if (replyParent && !subtreeMembers.has(replyParent)) {
          const parentIndex = remaining.indexOf(replyParent);
          if (parentIndex >= 0 && targetInsertAt <= parentIndex) {
            targetInsertAt = parentIndex + 1;
          }
        }
        if (targetInsertAt > remaining.length) {
          targetInsertAt = remaining.length;
        }

        order.splice(
          0,
          order.length,
          ...remaining.slice(0, targetInsertAt),
          ...moveBlock,
          ...remaining.slice(targetInsertAt)
        );

        movedTargets.add(targetId);
        sourceIndex = order.indexOf(sourceId);
        insertAt = sourceIndex + 1 + moveBlock.length;
      }
    }

    return order;
  }

  const finalOrder = enforceQuoteAdjacency(optimizedOrder);

  const depthMemo = new Map();
  function computeLayoutDepth(statusId, stack) {
    const key = String(statusId || "");
    if (!key) {
      return 0;
    }
    if (depthMemo.has(key)) {
      return depthMemo.get(key);
    }
    if (stack.has(key)) {
      return 0;
    }
    stack.add(key);
    const parent = replyParentByChild.get(key);
    let depth = 0;
    if (parent && tweetsById.has(parent) && parent !== key) {
      depth = computeLayoutDepth(parent, stack) + 1;
    }
    stack.delete(key);
    depthMemo.set(key, depth);
    return depth;
  }

  const rows = [];
  const indexByStatusId = new Map();
  finalOrder.forEach((statusId, index) => {
    indexByStatusId.set(String(statusId), index);
  });

  for (const statusId of finalOrder) {
    const tweet = tweetsById.get(statusId);
    if (!tweet) {
      continue;
    }
    const replyParent = replyParentByChild.get(statusId) || null;
    const quoteSources = quoteSourcesByTarget.get(statusId) || [];
    let quoteAnchor = null;
    let quoteAnchorIndex = -1;
    for (const sourceId of quoteSources) {
      const index = indexByStatusId.get(String(sourceId));
      const currentIndex = indexByStatusId.get(String(statusId));
      if (!Number.isFinite(index) || !Number.isFinite(currentIndex)) {
        continue;
      }
      if (index < currentIndex && index > quoteAnchorIndex) {
        quoteAnchor = String(sourceId);
        quoteAnchorIndex = index;
      }
    }
    const layoutDepth = computeLayoutDepth(statusId, new Set());
    let visualDepth = layoutDepth;
    if (quoteAnchor && tweetsById.has(quoteAnchor)) {
      const sourceDepth = computeLayoutDepth(quoteAnchor, new Set());
      visualDepth = Math.max(visualDepth, sourceDepth + 1);
    }
    const quoteIndent = Math.max(0, visualDepth - layoutDepth);
    rows.push({
      status_id: statusId,
      parent_status_id: replyParent,
      quote_parent_status_id: quoteAnchor,
      layout_parent_status_id: replyParent,
      tweet,
      depth: layoutDepth,
      quote_indent: quoteIndent,
      visual_depth: visualDepth,
    });
  }

  return rows;
}

function createGraphPanel(graph) {
  const wrap = document.createElement("section");
  wrap.className = "graph";

  const tweets = Array.isArray(graph && graph.tweets) ? graph.tweets : [];
  const edges = Array.isArray(graph && graph.edges) ? graph.edges : [];
  const tweetsById = new Map();
  for (const tweet of tweets) {
    if (tweet && tweet.status_id) {
      tweetsById.set(String(tweet.status_id), tweet);
    }
  }

  const primaryStatusId = String(
    (graph && graph.capture && graph.capture.primary_status_id) ||
    (tweets.find((tweet) => tweet && tweet.is_primary) || {}).status_id ||
    ""
  );
  const nonReplyEdgesBySource = collectNonReplyEdgesBySource(edges, tweetsById);
  const timelineRows = buildReplyTimelineRows(tweetsById, edges, primaryStatusId);

  const header = document.createElement("div");
  header.className = "graph-header";
  header.textContent = `Graph: tweets ${tweets.length}, edges ${edges.length}`;
  wrap.append(header);

  const timelineDetails = document.createElement("details");
  timelineDetails.className = "graph-related";
  timelineDetails.open = true;
  const timelineSummary = document.createElement("summary");
  timelineSummary.textContent = `Reply timeline (${timelineRows.length})`;
  timelineDetails.append(timelineSummary);

  if (timelineRows.length === 0) {
    const emptyTimeline = document.createElement("p");
    emptyTimeline.className = "graph-empty";
    emptyTimeline.textContent = "No tweets in this capture graph.";
    timelineDetails.append(emptyTimeline);
  } else {
    const timeline = document.createElement("div");
    timeline.className = "timeline";
    timeline.__graphEdges = edges;

    for (const row of timelineRows) {
      const item = document.createElement("article");
      item.className = "timeline-item";
      if (row.status_id === primaryStatusId || (row.tweet && row.tweet.is_primary)) {
        item.classList.add("timeline-primary");
      }
      if (Number(row.quote_indent) > 0) {
        item.classList.add("timeline-quote-indented");
      }
      item.dataset.statusId = String(row.status_id || "");
      item.dataset.parentStatusId = row.parent_status_id ? String(row.parent_status_id) : "";
      item.dataset.quoteParentStatusId = row.quote_parent_status_id ? String(row.quote_parent_status_id) : "";
      item.dataset.layoutParentStatusId = row.layout_parent_status_id ? String(row.layout_parent_status_id) : "";
      const visualDepth = Math.max(0, Number(row.visual_depth || row.depth || 0));
      item.dataset.depth = String(visualDepth);
      item.style.setProperty("--tree-depth", String(visualDepth));

      const node = document.createElement("span");
      node.className = "timeline-node";
      item.append(node);

      const body = document.createElement("div");
      body.className = "timeline-body";

      const title = document.createElement("div");
      title.className = "related-title";
      const label = formatTweetLabel(row.tweet);
      const postedAt = row.tweet && row.tweet.posted_at ? formatDateTime(row.tweet.posted_at) : "-";
      title.textContent = `${label} | ${postedAt}`;
      body.append(title);

      if (row.tweet && row.tweet.text) {
        const text = document.createElement("p");
        text.className = "related-text";
        text.textContent = compactText(row.tweet.text, 180);
        body.append(text);
      }

      const metricRow = createMetricPillRow((row.tweet && row.tweet.metrics) || {});
      if (metricRow.childElementCount > 0) {
        body.append(metricRow);
      }

      const outboundEdges = (nonReplyEdgesBySource.get(row.status_id) || [])
        .slice()
        .sort((left, right) => getEdgeTypeOrder(left.edge_type) - getEdgeTypeOrder(right.edge_type));
      if (outboundEdges.length > 0) {
        const relationList = document.createElement("div");
        relationList.className = "relation-link-list";

        for (const edge of outboundEdges) {
          const edgeType = edge.edge_type || "unknown";
          const relationItem = document.createElement("div");
          relationItem.className = `relation-link ${relationToneClass(edgeType)}`;

          const arrow = document.createElement("span");
          arrow.className = "relation-link-arrow";
          arrow.textContent = EDGE_ARROWS[edgeType] || "->";

          const relationText = document.createElement("span");
          relationText.className = "relation-link-text";
          relationText.textContent = `${RELATION_LABELS[edgeType] || edgeType} ${formatEdgeTargetLabel(
            edge,
            tweetsById
          )}`;

          relationItem.append(arrow, relationText);
          relationList.append(relationItem);
        }

        body.append(relationList);
      }

      item.append(body);
      timeline.append(item);
    }

    timelineDetails.append(timeline);
  }

  wrap.append(timelineDetails);

  const edgeDetails = document.createElement("details");
  edgeDetails.className = "graph-related";
  const edgeSummary = document.createElement("summary");
  edgeSummary.textContent = `All edges (${edges.length})`;
  edgeDetails.append(edgeSummary);

  if (edges.length === 0) {
    const emptyEdges = document.createElement("p");
    emptyEdges.className = "graph-empty";
    emptyEdges.textContent = "No edges in this capture.";
    edgeDetails.append(emptyEdges);
  } else {
    const list = document.createElement("ul");
    list.className = "edge-list";

    for (const edge of edges) {
      const item = document.createElement("li");
      item.className = "edge-item";

      const arrow = document.createElement("span");
      arrow.className = "edge-arrow";
      arrow.textContent = EDGE_ARROWS[edge.edge_type] || "->";

      const src = formatStatusIdLabel(edge.src_status_id, tweetsById);
      const dst = edge.dst_status_id
        ? formatStatusIdLabel(edge.dst_status_id, tweetsById)
        : edge.dst_url || "(external)";

      const text = document.createElement("span");
      text.className = "edge-text";
      text.textContent = `${src} ${dst}`;

      const type = document.createElement("span");
      type.className = `pill relation ${relationToneClass(edge.edge_type || "unknown")}`;
      type.textContent = edge.edge_type || "unknown";

      item.append(arrow, text, type);
      list.append(item);
    }

    edgeDetails.append(list);
  }

  wrap.append(edgeDetails);
  return wrap;
}

function createCaptureCard(capture) {
  const card = document.createElement("article");
  card.className = "capture";
  if (capture.is_archived) {
    card.classList.add("archived");
  }

  const metaRow = document.createElement("div");
  metaRow.className = "meta row";
  metaRow.append(`Capture #${capture.id}`);

  const statusIdNode = document.createElement("span");
  statusIdNode.className = "status-id";
  statusIdNode.textContent = capture.primary_status_id || "(no status_id)";
  metaRow.append(statusIdNode);

  const capturedAtNode = document.createElement("span");
  capturedAtNode.textContent = `captured: ${formatDateTime(capture.captured_at)}`;
  metaRow.append(capturedAtNode);

  const updatedAtNode = document.createElement("span");
  updatedAtNode.textContent = `updated: ${formatDateTime(capture.updated_at || capture.received_at)}`;
  metaRow.append(updatedAtNode);

  card.append(metaRow);

  const primaryTweet = readPrimaryTweet(capture);
  const primarySection = document.createElement("section");
  primarySection.className = "primary";

  const authorRow = document.createElement("div");
  authorRow.className = "primary-author";
  const authorName = primaryTweet.author.display_name || primaryTweet.author.handle || "(unknown)";
  const handleText = primaryTweet.author.handle_text || "";
  authorRow.textContent = handleText ? `${authorName} ${handleText}` : authorName;
  primarySection.append(authorRow);

  if (primaryTweet.text) {
    const textNode = document.createElement("p");
    textNode.className = "primary-text";
    textNode.textContent = compactText(primaryTweet.text, MAX_TEXT_PREVIEW);
    primarySection.append(textNode);
  }

  const primaryMetricRow = createMetricPillRow(primaryTweet.metrics || {});
  if (primaryMetricRow.childElementCount > 0) {
    primarySection.append(primaryMetricRow);
  }

  const edgeCounts = readEdgeCounts(capture);
  if (edgeCounts.total > 0) {
    const relationRow = document.createElement("div");
    relationRow.className = "pill-row";

    const totalPill = document.createElement("span");
    totalPill.className = "pill relation total";
    totalPill.textContent = `edges:${formatCount(edgeCounts.total)}`;
    relationRow.append(totalPill);

    for (const [key, label] of Object.entries(RELATION_LABELS)) {
      const count = edgeCounts[key];
      if (!count) {
        continue;
      }
      const pill = document.createElement("span");
      pill.className = "pill relation";
      pill.textContent = `${label}:${count}`;
      relationRow.append(pill);
    }
    primarySection.append(relationRow);
  }

  card.append(primarySection);

  const tagsField = document.createElement("div");
  tagsField.className = "field";
  const tagsLabel = document.createElement("label");
  tagsLabel.textContent = "Tags";
  const tagsInput = document.createElement("input");
  tagsInput.type = "text";
  tagsInput.value = Array.isArray(capture.tags) ? capture.tags.join(", ") : "";
  tagsInput.placeholder = "research, ai";
  tagsField.append(tagsLabel, tagsInput);

  const tagSuggestionRow = document.createElement("div");
  tagSuggestionRow.className = "tag-suggestion-row";
  tagsField.append(tagSuggestionRow);

  const tagAutocomplete = document.createElement("div");
  tagAutocomplete.className = "tag-autocomplete";
  tagAutocomplete.hidden = true;
  tagsField.append(tagAutocomplete);

  const tagShortcutHint = document.createElement("div");
  tagShortcutHint.className = "tag-autocomplete-hint";
  tagShortcutHint.textContent = "Tag autocomplete: ↑↓ + Enter/Tab";
  tagShortcutHint.hidden = true;
  tagsField.append(tagShortcutHint);

  let autocompleteCandidates = [];
  let autocompleteActiveIndex = -1;
  let autocompleteOpen = false;

  function applyTagSelection(tag) {
    const normalized = normalizeTagValue(tag);
    if (!normalized) {
      return;
    }
    const context = readTagInputContext(tagsInput.value);
    const merged = normalizeTags([...context.committedTags, normalized], 16);
    tagsInput.value = merged.length > 0 ? `${merged.join(", ")}, ` : "";
    autocompleteActiveIndex = -1;
    renderTagSuggestions();
    renderTagAutocomplete();
    tagsInput.focus();
  }

  function getAutocompleteCandidates() {
    const context = readTagInputContext(tagsInput.value);
    const selected = new Set(context.committedTags);
    let candidates = (state.knownTags || []).filter((tag) => !selected.has(tag));
    const needle = context.currentNormalized || "";
    if (needle) {
      const startsWith = [];
      const contains = [];
      for (const tag of candidates) {
        if (tag.startsWith(needle)) {
          startsWith.push(tag);
        } else if (tag.includes(needle)) {
          contains.push(tag);
        }
      }
      candidates = [...startsWith, ...contains];
    }
    return candidates.slice(0, 12);
  }

  function renderTagAutocomplete() {
    autocompleteCandidates = getAutocompleteCandidates();
    if (autocompleteActiveIndex >= autocompleteCandidates.length) {
      autocompleteActiveIndex = autocompleteCandidates.length - 1;
    }
    if (autocompleteActiveIndex < 0 && autocompleteCandidates.length > 0) {
      autocompleteActiveIndex = 0;
    }

    const shouldShow = autocompleteOpen && autocompleteCandidates.length > 0;
    tagAutocomplete.hidden = !shouldShow;
    tagShortcutHint.hidden = !shouldShow;
    tagAutocomplete.innerHTML = "";

    if (!shouldShow) {
      return;
    }

    autocompleteCandidates.forEach((candidate, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-autocomplete-item";
      if (index === autocompleteActiveIndex) {
        button.classList.add("active");
      }
      button.textContent = candidate;
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
      });
      button.addEventListener("click", () => {
        applyTagSelection(candidate);
      });
      tagAutocomplete.append(button);
    });
  }

  function renderTagSuggestions() {
    tagSuggestionRow.innerHTML = "";
    const current = new Set(normalizeTags(splitTagInput(tagsInput.value), 16));
    const candidates = (state.knownTags || []).filter((tag) => !current.has(tag));
    if (candidates.length === 0) {
      renderTagAutocomplete();
      return;
    }

    const hint = document.createElement("span");
    hint.className = "tag-suggestion-label";
    hint.textContent = "suggest:";
    tagSuggestionRow.append(hint);

    for (const tag of candidates.slice(0, 12)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tag-suggestion";
      button.textContent = tag;
      button.addEventListener("click", () => {
        applyTagSelection(tag);
      });
      tagSuggestionRow.append(button);
    }
    renderTagAutocomplete();
  }

  renderTagSuggestions();
  tagsInput.addEventListener("input", () => {
    autocompleteOpen = true;
    autocompleteActiveIndex = -1;
    renderTagSuggestions();
  });
  tagsInput.addEventListener("focus", () => {
    autocompleteOpen = true;
    renderTagAutocomplete();
  });
  tagsInput.addEventListener("blur", () => {
    window.setTimeout(() => {
      autocompleteOpen = false;
      renderTagAutocomplete();
    }, 120);
  });
  tagsInput.addEventListener("keydown", (event) => {
    if (autocompleteCandidates.length === 0 || !autocompleteOpen) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      autocompleteActiveIndex =
        autocompleteActiveIndex >= autocompleteCandidates.length - 1 ? 0 : autocompleteActiveIndex + 1;
      renderTagAutocomplete();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      autocompleteActiveIndex =
        autocompleteActiveIndex <= 0 ? autocompleteCandidates.length - 1 : autocompleteActiveIndex - 1;
      renderTagAutocomplete();
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      if (autocompleteActiveIndex >= 0 && autocompleteActiveIndex < autocompleteCandidates.length) {
        event.preventDefault();
        applyTagSelection(autocompleteCandidates[autocompleteActiveIndex]);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      autocompleteOpen = false;
      renderTagAutocomplete();
    }
  });

  card.append(tagsField);

  const noteField = document.createElement("div");
  noteField.className = "field";
  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Note";
  const noteInput = document.createElement("textarea");
  noteInput.value = capture.note || "";
  noteInput.placeholder = "memo";
  noteField.append(noteLabel, noteInput);
  card.append(noteField);

  const graphPanel = document.createElement("div");
  graphPanel.className = "graph-wrap";
  graphPanel.hidden = true;
  card.append(graphPanel);

  const actions = document.createElement("div");
  actions.className = "actions";

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";

  const detailButton = document.createElement("button");
  detailButton.type = "button";
  detailButton.className = "secondary";
  detailButton.textContent = "Show details";

  const archiveLabel = document.createElement("label");
  archiveLabel.className = "check";
  const archiveToggle = document.createElement("input");
  archiveToggle.type = "checkbox";
  archiveToggle.checked = Boolean(capture.is_archived);
  const archiveText = document.createElement("span");
  archiveText.textContent = "Archived";
  archiveLabel.append(archiveToggle, archiveText);

  actions.append(saveButton, detailButton, archiveLabel);

  const statusUrl = normalizeStatusUrl(capture);
  if (statusUrl) {
    const openLink = document.createElement("a");
    openLink.className = "link";
    openLink.href = statusUrl;
    openLink.target = "_blank";
    openLink.rel = "noopener noreferrer";
    openLink.textContent = "Open";
    actions.append(openLink);
  }

  const rowStatus = document.createElement("span");
  rowStatus.className = "row-status";

  actions.append(rowStatus);
  card.append(actions);

  async function saveCapture() {
    saveButton.disabled = true;
    rowStatus.textContent = "Saving...";
    try {
      const result = await sendRuntimeMessage({
        type: "x_clipper_capture_update",
        capture_id: capture.id,
        tags: normalizeTags(splitTagInput(tagsInput.value), 16),
        note: noteInput.value,
        is_archived: Boolean(archiveToggle.checked),
      });
      if (!result || !result.ok) {
        throw new Error((result && result.error) || "update_failed");
      }

      const saved = result.capture || {};
      capture.tags = Array.isArray(saved.tags) ? saved.tags : [];
      capture.note = saved.note || null;
      capture.is_archived = Boolean(saved.is_archived);
      capture.updated_at = saved.updated_at || capture.updated_at;

      tagsInput.value = capture.tags.join(", ");
      noteInput.value = capture.note || "";
      archiveToggle.checked = capture.is_archived;
      card.classList.toggle("archived", capture.is_archived);

      mergeKnownTags(capture.tags || []);
      renderTagSuggestions();

      if (!state.includeArchived && capture.is_archived) {
        card.remove();
        setStatus(`Capture #${capture.id} archived and hidden (include archived is off).`, false);
      }

      rowStatus.textContent = "Saved";
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      rowStatus.textContent = "Save failed";
      setStatus(`Save failed (#${capture.id}): ${message}`, true);
    } finally {
      saveButton.disabled = false;
    }
  }

  async function toggleGraph() {
    if (!graphPanel.hidden) {
      graphPanel.hidden = true;
      detailButton.textContent = "Show details";
      return;
    }

    if (!capture.graph_loaded) {
      detailButton.disabled = true;
      rowStatus.textContent = "Loading details...";
      try {
        const result = await sendRuntimeMessage({
          type: "x_clipper_capture_graph",
          capture_id: capture.id,
        });
        if (!result || !result.ok) {
          throw new Error((result && result.error) || "capture_graph_failed");
        }

        capture.graph_loaded = true;
        capture.graph = {
          capture: result.capture || null,
          tweets: Array.isArray(result.tweets) ? result.tweets : [],
          edges: Array.isArray(result.edges) ? result.edges : [],
        };

        graphPanel.innerHTML = "";
        graphPanel.append(createGraphPanel(capture.graph));
        requestAnimationFrame(() => {
          renderTimelineConnectors(graphPanel);
        });
        rowStatus.textContent = "Details loaded";
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        rowStatus.textContent = "Details failed";
        setStatus(`Details failed (#${capture.id}): ${message}`, true);
        detailButton.disabled = false;
        return;
      } finally {
        detailButton.disabled = false;
      }
    }

    graphPanel.hidden = false;
    detailButton.textContent = "Hide details";
    requestAnimationFrame(() => {
      renderTimelineConnectors(graphPanel);
    });
  }

  saveButton.addEventListener("click", () => {
    saveCapture().catch((error) => {
      setStatus(`Save failed (#${capture.id}): ${error && error.message ? error.message : String(error)}`, true);
    });
  });

  detailButton.addEventListener("click", () => {
    toggleGraph().catch((error) => {
      setStatus(`Details failed (#${capture.id}): ${error && error.message ? error.message : String(error)}`, true);
    });
  });

  return card;
}

function renderCaptures() {
  const root = $("listRoot");
  root.innerHTML = "";

  if (!Array.isArray(state.captures) || state.captures.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No captures found.";
    root.append(empty);
  } else {
    for (const capture of state.captures) {
      root.append(createCaptureCard(capture));
    }
  }

  const loadMoreButton = $("loadMoreButton");
  loadMoreButton.hidden = !state.hasMore;
  loadMoreButton.disabled = state.loading;
}

async function loadCaptures(append) {
  if (state.loading) {
    return;
  }
  state.loading = true;
  const loadMoreButton = $("loadMoreButton");
  loadMoreButton.disabled = true;
  setStatus("Loading...", false);

  try {
    const result = await sendRuntimeMessage({
      type: "x_clipper_logs_list",
      limit: DEFAULT_PAGE_SIZE,
      offset: append ? state.offset : 0,
      include_archived: state.includeArchived,
    });

    if (!result || !result.ok) {
      throw new Error((result && result.error) || "logs_list_failed");
    }

    const received = Array.isArray(result.captures) ? result.captures : [];
    if (append) {
      state.captures = state.captures.concat(received);
      state.offset += received.length;
    } else {
      state.captures = received;
      state.offset = received.length;
    }

    mergeKnownTagsFromCaptures(received);

    state.hasMore = received.length >= DEFAULT_PAGE_SIZE;
    renderCaptures();

    const archivedLabel = state.includeArchived ? " (including archived)" : "";
    setStatus(`Loaded ${state.captures.length} capture(s)${archivedLabel}.`, false);
  } catch (error) {
    setStatus(`Load failed: ${error && error.message ? error.message : String(error)}`, true);
  } finally {
    state.loading = false;
    loadMoreButton.disabled = false;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const includeArchived = $("includeArchived");
  const reloadButton = $("reloadButton");
  const loadMoreButton = $("loadMoreButton");

  includeArchived.addEventListener("change", () => {
    state.includeArchived = Boolean(includeArchived.checked);
    loadCaptures(false).catch((error) => {
      setStatus(`Load failed: ${error && error.message ? error.message : String(error)}`, true);
    });
  });

  reloadButton.addEventListener("click", () => {
    loadCaptures(false).catch((error) => {
      setStatus(`Load failed: ${error && error.message ? error.message : String(error)}`, true);
    });
  });

  loadMoreButton.addEventListener("click", () => {
    loadCaptures(true).catch((error) => {
      setStatus(`Load more failed: ${error && error.message ? error.message : String(error)}`, true);
    });
  });

  loadKnownTagsFromOptions()
    .catch(() => {
      // ignore tag option load errors
    })
    .finally(() => {
      loadCaptures(false).catch((error) => {
        setStatus(`Load failed: ${error && error.message ? error.message : String(error)}`, true);
      });
    });

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(() => {
      const visiblePanels = document.querySelectorAll(".graph-wrap:not([hidden])");
      for (const panel of visiblePanels) {
        renderTimelineConnectors(panel);
      }
    }, 80);
  });
});
