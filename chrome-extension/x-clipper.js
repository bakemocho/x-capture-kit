(() => {
  "use strict";

  const TWEET_SELECTOR = 'article[data-testid="tweet"]';
  const TWEET_TEXT_SELECTOR = '[data-testid="tweetText"]';
  const ARTICLE_READ_VIEW_SELECTOR = '[data-testid="twitterArticleReadView"]';
  const ARTICLE_TITLE_SELECTOR = '[data-testid="twitter-article-title"]';
  const USER_NAME_SELECTOR = '[data-testid="User-Name"]';
  const STATUS_LINK_PATTERN = /\/status\/(\d+)/;
  const STATUS_LINK_SELECTOR = 'a[href*="/status/"]';
  const ARTICLE_LINK_PATTERN = /\/article\/(\d+)/;
  const ARTICLE_LINK_SELECTOR = 'a[href*="/article/"]';
  const PHOTO_LINK_SELECTOR = 'a[href*="/status/"][href*="/photo/"]';
  const ANALYTICS_LINK_SELECTOR = 'a[href*="/status/"][href*="/analytics"]';
  const SOCIAL_CONTEXT_SELECTOR = '[data-testid="socialContext"]';
  const STATUS_URL_IN_TEXT_PATTERN =
    /(?:https?:\/\/(?:x|twitter)\.com)?\/(?:[A-Za-z0-9_]{1,20}|i\/web)\/status\/\d+(?:\?[^\s"'<>]*)?/gi;
  const MUTED_WARNING_PATTERN =
    /このポストにはミュートしたキーワードが含まれています|このポストにはミュートしたワードが含まれています|This post contains muted words/i;
  const X_HOST_PATTERN = /^(?:x|twitter)\.com$/i;
  const STATUS_DETAIL_PATH_PATTERN = /^\/(?:i\/web\/status|[A-Za-z0-9_]{1,20}\/status)\/\d+(?:[/?#]|$)/i;

  function normalizeWhitespace(input) {
    return (input || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function nodeText(node) {
    if (!node) {
      return "";
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }
    const tag = node.tagName.toLowerCase();
    if (tag === "img") {
      return node.getAttribute("alt") || "";
    }
    if (tag === "br") {
      return "\n";
    }
    let output = "";
    for (const child of node.childNodes) {
      output += nodeText(child);
    }
    return output;
  }

  function toAbsoluteUrl(href) {
    try {
      const origin = window.location.origin || "";
      const isLocalOrigin =
        origin === "null" ||
        /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin);
      const base = isLocalOrigin ? "https://x.com" : origin;
      return new URL(href, base).toString();
    } catch (_error) {
      return null;
    }
  }

  function parseStatusId(href) {
    const match = (href || "").match(STATUS_LINK_PATTERN);
    return match ? match[1] : null;
  }

  function parseStatusRefFromHref(href) {
    if (!href) {
      return null;
    }
    const absolute = toAbsoluteUrl(href);
    if (!absolute) {
      return null;
    }
    let parsed = null;
    try {
      parsed = new URL(absolute);
    } catch (_error) {
      return null;
    }
    if (!/\/status\/\d+/.test(parsed.pathname)) {
      return null;
    }
    const statusId = parseStatusId(parsed.pathname);
    if (!statusId) {
      return null;
    }
    const handleMatch = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,20})\/status\/\d+/);
    const handle = handleMatch ? handleMatch[1] : null;
    return {
      status_id: statusId,
      status_url: buildHandleStatusUrl(handle, statusId) || `https://x.com/i/web/status/${statusId}`,
      handle: handle || null,
    };
  }

  function parseArticleId(href) {
    const match = (href || "").match(ARTICLE_LINK_PATTERN);
    return match ? match[1] : null;
  }

  function buildHandleStatusUrl(handle, statusId) {
    const safeHandle = normalizeHandle(handle);
    const safeStatusId = normalizeStatusId(statusId);
    if (safeHandle && safeStatusId) {
      return `https://x.com/${safeHandle}/status/${safeStatusId}`;
    }
    if (safeStatusId) {
      return `https://x.com/i/web/status/${safeStatusId}`;
    }
    return null;
  }

  function statusUrlFromCanonicalHref(canonicalHref, canonicalId) {
    const safeCanonicalId = normalizeStatusId(canonicalId);
    if (!safeCanonicalId) {
      return canonicalHref || null;
    }
    try {
      const parsed = new URL(canonicalHref || window.location.href, window.location.origin || "https://x.com");
      const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,20})\/(?:status|article)\/(\d+)(?:[/?#]|$)/i);
      if (match && match[2] === safeCanonicalId) {
        return `https://x.com/${match[1]}/status/${safeCanonicalId}`;
      }
    } catch (_error) {
      // ignore
    }
    return `https://x.com/i/web/status/${safeCanonicalId}`;
  }

  function isSupportedCapturePage() {
    let locationObject = null;
    try {
      locationObject = window.location;
    } catch (_error) {
      return true;
    }

    const host = String(locationObject && locationObject.hostname ? locationObject.hostname : "");
    if (!X_HOST_PATTERN.test(host)) {
      // local fixture/sanitized file testing is still allowed.
      return true;
    }

    const pathname = String(locationObject && locationObject.pathname ? locationObject.pathname : "");
    return STATUS_DETAIL_PATH_PATTERN.test(pathname);
  }

  function safeGetIn(value, path) {
    let current = value;
    for (const key of path) {
      if (current == null) {
        return null;
      }
      current = safeGet(current, key);
    }
    return current == null ? null : current;
  }

  function firstString(values) {
    for (const value of values) {
      if (typeof value === "string") {
        const text = value.trim();
        if (text) {
          return text;
        }
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }
    return null;
  }

  function normalizeStatusId(value) {
    const text = firstString([value]);
    if (!text) {
      return null;
    }
    if (!/^\d{8,25}$/.test(text)) {
      return null;
    }
    return text;
  }

  function normalizeHandle(value) {
    const text = firstString([value]);
    if (!text) {
      return null;
    }
    const handle = text.replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,20}$/.test(handle)) {
      return null;
    }
    return handle;
  }

  function parseNumericCount(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value < 0) {
        return null;
      }
      return Math.trunc(value);
    }
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.replace(/,/g, "").trim();
    if (!/^\d+$/.test(normalized)) {
      return null;
    }
    const count = Number(normalized);
    if (!Number.isFinite(count) || count < 0) {
      return null;
    }
    return Math.trunc(count);
  }

  function parseTweetCreatedAt(value) {
    const text = firstString([value]);
    if (!text) {
      return null;
    }
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date.toISOString();
  }

  function safeOwnKeys(value) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return [];
    }
    try {
      return Object.keys(value);
    } catch (_error) {
      return [];
    }
  }

  function safeGet(value, key) {
    try {
      return value[key];
    } catch (_error) {
      return undefined;
    }
  }

  function normalizeStatusUrlCandidate(input) {
    if (!input) {
      return null;
    }
    const raw = String(input).trim().replace(/[)\],.;]+$/g, "");
    const absolute = toAbsoluteUrl(raw);
    if (!absolute) {
      return null;
    }

    let parsed = null;
    try {
      parsed = new URL(absolute);
    } catch (_error) {
      return null;
    }

    if (!/\/status\/\d+/.test(parsed.pathname)) {
      return null;
    }
    if (/\/status\/\d+\/(photo|video|analytics|quotes)/.test(parsed.pathname)) {
      return null;
    }

    const statusId = parseStatusId(parsed.pathname);
    if (!statusId) {
      return null;
    }

    const handleMatch = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,20})\/status\/\d+/);
    if (handleMatch) {
      return `https://x.com/${handleMatch[1]}/status/${statusId}`;
    }

    if (/^\/i\/web\/status\/\d+/.test(parsed.pathname)) {
      return `https://x.com/i/web/status/${statusId}`;
    }

    return `https://x.com/i/web/status/${statusId}`;
  }

  function parseStatusUrlParts(input) {
    const normalized = normalizeStatusUrlCandidate(input);
    if (!normalized) {
      return null;
    }
    const statusId = parseStatusId(normalized);
    if (!statusId) {
      return null;
    }
    const handleMatch = normalized.match(/^https:\/\/x\.com\/([A-Za-z0-9_]{1,20})\/status\/\d+/i);
    return {
      status_id: statusId,
      status_url: normalized,
      handle: handleMatch ? handleMatch[1] : null,
    };
  }

  function isHandleStatusUrl(url) {
    return /^https:\/\/x\.com\/[A-Za-z0-9_]{1,20}\/status\/\d+/i.test(String(url || ""));
  }

  function scanStatusUrlCandidatesInString(input) {
    const text = String(input || "");
    const out = [];
    let match = null;
    while ((match = STATUS_URL_IN_TEXT_PATTERN.exec(text))) {
      const normalized = normalizeStatusUrlCandidate(match[0]);
      if (normalized) {
        out.push(normalized);
      }
    }
    STATUS_URL_IN_TEXT_PATTERN.lastIndex = 0;
    return out;
  }

  function collectReactPayloads(root) {
    const payloads = [];
    const queue = [root];
    const seenNodes = new Set();
    let hops = 0;

    while (queue.length > 0 && hops < 160) {
      const node = queue.shift();
      hops += 1;
      if (!node || seenNodes.has(node)) {
        continue;
      }
      seenNodes.add(node);

      const keys = safeOwnKeys(node);
      for (const key of keys) {
        if (key.startsWith("__reactProps$") || key.startsWith("__reactFiber$")) {
          const payload = safeGet(node, key);
          if (payload) {
            payloads.push(payload);
          }
        }
      }

      const children = safeGet(node, "children");
      if (children && children.length > 0) {
        for (const child of children) {
          queue.push(child);
        }
      }
    }

    return payloads;
  }

  function collectStatusSignalsFromValue(seedValue) {
    const urlCandidates = [];
    const statusIds = [];
    const handles = [];

    const stack = [seedValue];
    const seen = new Set();
    let visited = 0;

    while (stack.length > 0 && visited < 1800) {
      const value = stack.pop();
      visited += 1;
      if (value == null) {
        continue;
      }

      if (typeof value === "string") {
        for (const url of scanStatusUrlCandidatesInString(value)) {
          urlCandidates.push(url);
        }
        continue;
      }

      if (typeof value === "number") {
        if (Number.isSafeInteger(value) && value > 10_000_000) {
          statusIds.push(String(value));
        }
        continue;
      }

      if (typeof value !== "object") {
        continue;
      }
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);

      if (Array.isArray(value)) {
        for (const item of value) {
          stack.push(item);
        }
        continue;
      }

      const keys = safeOwnKeys(value);
      for (const key of keys) {
        const child = safeGet(value, key);
        const keyLower = key.toLowerCase();

        if (typeof child === "string") {
          for (const url of scanStatusUrlCandidatesInString(child)) {
            urlCandidates.push(url);
          }

          if (
            /(^|_)(rest_id|status_id|quoted_status_id|tweet_id|id_str|id)($|_)/.test(keyLower) &&
            /^\d{8,25}$/.test(child)
          ) {
            statusIds.push(child);
          }
          if (
            /(^|_)(screen_name|user_name|handle|username)($|_)/.test(keyLower) &&
            /^[A-Za-z0-9_]{1,20}$/.test(child)
          ) {
            handles.push(child);
          }
        } else if (typeof child === "number") {
          if (/(^|_)(rest_id|status_id|quoted_status_id|tweet_id|id)($|_)/.test(keyLower)) {
            if (Number.isSafeInteger(child) && child > 10_000_000) {
              statusIds.push(String(child));
            }
          }
        }

        if (
          child &&
          typeof child === "object" &&
          (visited < 800 ||
            /(url|uri|href|link|tweet|status|quote|quoted|legacy|result|entity)/.test(keyLower))
        ) {
          stack.push(child);
        }
      }
    }

    return {
      urls: uniq(urlCandidates),
      status_ids: uniq(statusIds),
      handles: uniq(handles),
    };
  }

  function pickBestStatusUrl(urls, preferredHandle) {
    if (!urls || urls.length === 0) {
      return null;
    }
    const normalizedHandle = (preferredHandle || "").toLowerCase();

    const scored = urls.map((url) => {
      const id = parseStatusId(url) || "";
      let score = 10;
      if (/^https:\/\/x\.com\/[A-Za-z0-9_]{1,20}\/status\/\d+/.test(url)) {
        score += 20;
      }
      if (/^https:\/\/x\.com\/i\/web\/status\/\d+/.test(url)) {
        score += 8;
      }
      if (normalizedHandle && new RegExp(`^https:\\/\\/x\\.com\\/${normalizedHandle}\\/status\\/`, "i").test(url)) {
        score += 40;
      }
      score += Math.min(id.length, 19) / 10;
      return { url, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].url;
  }

  function inferStatusFromReactPayload(root, preferredHandle) {
    const payloads = collectReactPayloads(root);
    if (payloads.length === 0) {
      return {
        status_id: null,
        status_url: null,
        probe_error: null,
      };
    }

    const urlCandidates = [];
    const statusIds = [];
    const handles = [];
    let probeError = null;

    for (const payload of payloads) {
      try {
        const signals = collectStatusSignalsFromValue(payload);
        urlCandidates.push(...signals.urls);
        statusIds.push(...signals.status_ids);
        handles.push(...signals.handles);
      } catch (error) {
        if (!probeError && error && error.message) {
          probeError = error.message;
        }
      }
    }

    const pickedUrl = pickBestStatusUrl(uniq(urlCandidates), preferredHandle);
    let statusId = pickedUrl ? parseStatusId(pickedUrl) : null;
    let statusUrl = pickedUrl;

    if (!statusId && statusIds.length > 0) {
      statusId = statusIds.sort((a, b) => b.length - a.length)[0];
    }

    if (!statusUrl && statusId) {
      const fallbackHandle =
        preferredHandle ||
        handles.find((value) => /^[A-Za-z0-9_]{1,20}$/.test(value)) ||
        null;
      statusUrl = fallbackHandle
        ? `https://x.com/${fallbackHandle}/status/${statusId}`
        : `https://x.com/i/web/status/${statusId}`;
    }

    return {
      status_id: statusId || null,
      status_url: statusUrl || null,
      probe_error: probeError,
    };
  }

  function extractTweetNodeSummary(node) {
    if (!node || typeof node !== "object") {
      return null;
    }

    let tweet = node;
    const nestedTweet = safeGet(node, "tweet");
    if (nestedTweet && typeof nestedTweet === "object") {
      tweet = nestedTweet;
    }

    const statusId = normalizeStatusId(
      firstString([
        safeGet(tweet, "rest_id"),
        safeGet(tweet, "id_str"),
        safeGetIn(tweet, ["legacy", "id_str"]),
        safeGet(tweet, "tweet_id"),
      ])
    );
    if (!statusId) {
      return null;
    }

    const authorHandle = normalizeHandle(
      firstString([
        safeGetIn(tweet, ["core", "user_results", "result", "legacy", "screen_name"]),
        safeGetIn(tweet, ["core", "user_results", "result", "result", "legacy", "screen_name"]),
        safeGetIn(tweet, ["legacy", "screen_name"]),
        safeGetIn(tweet, ["user", "legacy", "screen_name"]),
        safeGetIn(tweet, ["user_results", "result", "legacy", "screen_name"]),
        safeGetIn(tweet, ["user_results", "result", "result", "legacy", "screen_name"]),
      ])
    );
    const authorName =
      firstString([
        safeGetIn(tweet, ["core", "user_results", "result", "legacy", "name"]),
        safeGetIn(tweet, ["core", "user_results", "result", "result", "legacy", "name"]),
        safeGetIn(tweet, ["legacy", "name"]),
        safeGetIn(tweet, ["user", "legacy", "name"]),
        safeGetIn(tweet, ["user_results", "result", "legacy", "name"]),
        safeGetIn(tweet, ["user_results", "result", "result", "legacy", "name"]),
      ]) || null;

    const text =
      normalizeWhitespace(
        firstString([
          safeGetIn(tweet, ["note_tweet", "note_tweet_results", "result", "text"]),
          safeGetIn(tweet, ["legacy", "full_text"]),
          safeGetIn(tweet, ["legacy", "text"]),
          safeGet(tweet, "full_text"),
          safeGet(tweet, "text"),
        ]) || ""
      ) || null;

    const createdAt = parseTweetCreatedAt(
      firstString([
        safeGetIn(tweet, ["legacy", "created_at"]),
        safeGet(tweet, "created_at"),
      ])
    );

    const replyCount = parseNumericCount(
      firstString([
        safeGetIn(tweet, ["legacy", "reply_count"]),
        safeGet(tweet, "reply_count"),
      ])
    );
    const repostCount = parseNumericCount(
      firstString([
        safeGetIn(tweet, ["legacy", "retweet_count"]),
        safeGet(tweet, "retweet_count"),
      ])
    );
    const likeCount = parseNumericCount(
      firstString([
        safeGetIn(tweet, ["legacy", "favorite_count"]),
        safeGet(tweet, "favorite_count"),
      ])
    );
    const bookmarkCount = parseNumericCount(
      firstString([
        safeGetIn(tweet, ["legacy", "bookmark_count"]),
        safeGet(tweet, "bookmark_count"),
      ])
    );
    const viewsCount = parseNumericCount(
      firstString([
        safeGetIn(tweet, ["views", "count"]),
        safeGetIn(tweet, ["view_count_info", "count"]),
        safeGetIn(tweet, ["legacy", "view_count"]),
        safeGet(tweet, "view_count"),
      ])
    );

    const quotedStatusId = normalizeStatusId(
      firstString([
        safeGetIn(tweet, ["legacy", "quoted_status_id_str"]),
        safeGet(tweet, "quoted_status_id_str"),
        safeGetIn(tweet, ["legacy", "quoted_status_id"]),
        safeGet(tweet, "quoted_status_id"),
      ])
    );

    const quotedStatusUrl = normalizeStatusUrlCandidate(
      firstString([
        safeGetIn(tweet, ["quoted_status_permalink", "expanded"]),
        safeGetIn(tweet, ["quoted_status_permalink", "url"]),
      ])
    );

    const inReplyToStatusId = normalizeStatusId(
      firstString([
        safeGetIn(tweet, ["legacy", "in_reply_to_status_id_str"]),
        safeGet(tweet, "in_reply_to_status_id_str"),
        safeGetIn(tweet, ["legacy", "in_reply_to_status_id"]),
        safeGet(tweet, "in_reply_to_status_id"),
      ])
    );

    const inReplyToScreenName = normalizeHandle(
      firstString([
        safeGetIn(tweet, ["legacy", "in_reply_to_screen_name"]),
        safeGet(tweet, "in_reply_to_screen_name"),
      ])
    );

    const statusUrl = authorHandle
      ? `https://x.com/${authorHandle}/status/${statusId}`
      : `https://x.com/i/web/status/${statusId}`;

    return {
      status_id: statusId,
      status_url: statusUrl,
      author_handle: authorHandle,
      author_name: authorName,
      text,
      url_entities: extractUrlEntitiesFromTweet(tweet),
      created_at: createdAt,
      reply_count: replyCount,
      repost_count: repostCount,
      like_count: likeCount,
      bookmark_count: bookmarkCount,
      views_count: viewsCount,
      quoted_status_id: quotedStatusId,
      quoted_status_url: quotedStatusUrl,
      in_reply_to_status_id: inReplyToStatusId,
      in_reply_to_screen_name: inReplyToScreenName,
    };
  }

  function extractUrlEntitiesFromTweet(tweet) {
    const containers = [
      safeGetIn(tweet, ["legacy", "entities", "urls"]),
      safeGetIn(tweet, ["entities", "urls"]),
      safeGetIn(tweet, ["note_tweet", "note_tweet_results", "result", "entity_set", "urls"]),
      safeGetIn(tweet, ["note_tweet", "note_tweet_results", "result", "entities", "urls"]),
    ];
    const out = [];
    const seen = new Set();

    for (const container of containers) {
      if (!Array.isArray(container)) {
        continue;
      }
      for (const item of container) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const shortUrl = normalizeHttpUrlCandidate(
          firstString([
            safeGet(item, "url"),
          ])
        );
        const expandedUrl = normalizeHttpUrlCandidate(
          firstString([
            safeGet(item, "expanded_url"),
            safeGet(item, "expanded"),
            safeGet(item, "unwound_url"),
          ])
        );
        const displayUrl = firstString([safeGet(item, "display_url")]) || null;
        if (!shortUrl && !expandedUrl) {
          continue;
        }
        const normalizedShort = shortUrl || expandedUrl;
        const normalizedExpanded = expandedUrl || shortUrl;
        if (!normalizedShort || !normalizedExpanded) {
          continue;
        }
        const key = `${normalizedShort}\n${normalizedExpanded}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        out.push({
          short_url: normalizedShort,
          expanded_url: normalizedExpanded,
          display_url: displayUrl,
        });
      }
    }

    return out;
  }

  function collectTweetNodeSummaries(seedValue) {
    const out = [];
    const stack = [seedValue];
    const seen = new Set();
    let visited = 0;

    while (stack.length > 0 && visited < 2500) {
      const value = stack.pop();
      visited += 1;
      if (value == null) {
        continue;
      }
      if (typeof value !== "object") {
        continue;
      }
      if (seen.has(value)) {
        continue;
      }
      seen.add(value);

      const summary = extractTweetNodeSummary(value);
      if (summary) {
        out.push(summary);
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          stack.push(item);
        }
        continue;
      }

      const keys = safeOwnKeys(value);
      for (const key of keys) {
        const child = safeGet(value, key);
        if (child && typeof child === "object") {
          stack.push(child);
        }
      }
    }

    return out;
  }

  function scoreTweetSummary(summary) {
    let score = 0;
    if (!summary) {
      return score;
    }
    if (summary.author_handle) {
      score += 5;
    }
    if (summary.text) {
      score += Math.min(summary.text.length, 120) / 20;
    }
    if (summary.quoted_status_id) {
      score += 7;
    }
    if (summary.quoted_status_url) {
      score += 4;
    }
    return score;
  }

  function mergeUrlEntityLists(primaryList, secondaryList) {
    const out = [];
    const seen = new Set();
    for (const source of [primaryList, secondaryList]) {
      if (!Array.isArray(source)) {
        continue;
      }
      for (const entity of source) {
        if (!entity || typeof entity !== "object") {
          continue;
        }
        const shortUrl = normalizeHttpUrlCandidate(
          firstString([
            entity.short_url,
            entity.url,
          ])
        );
        const expandedUrl = normalizeHttpUrlCandidate(
          firstString([
            entity.expanded_url,
            entity.expanded,
            entity.unwound_url,
          ])
        );
        if (!shortUrl && !expandedUrl) {
          continue;
        }
        const normalizedShort = shortUrl || expandedUrl;
        const normalizedExpanded = expandedUrl || shortUrl;
        if (!normalizedShort || !normalizedExpanded) {
          continue;
        }
        const key = `${normalizedShort}\n${normalizedExpanded}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        out.push({
          short_url: normalizedShort,
          expanded_url: normalizedExpanded,
          display_url: firstString([entity.display_url]) || null,
        });
      }
    }
    return out;
  }

  function buildBestSummaryByStatus(summaries) {
    const bestByStatus = new Map();
    for (const summary of summaries) {
      const existing = bestByStatus.get(summary.status_id);
      if (!existing) {
        bestByStatus.set(summary.status_id, summary);
        continue;
      }
      const summaryScore = scoreTweetSummary(summary);
      const existingScore = scoreTweetSummary(existing);
      const primary = summaryScore >= existingScore ? { ...summary } : { ...existing };
      const secondary = summaryScore >= existingScore ? existing : summary;

      if (!primary.author_handle && secondary.author_handle) {
        primary.author_handle = secondary.author_handle;
      }
      if (!primary.author_name && secondary.author_name) {
        primary.author_name = secondary.author_name;
      }
      if (!primary.text && secondary.text) {
        primary.text = secondary.text;
      }
      if (!primary.created_at && secondary.created_at) {
        primary.created_at = secondary.created_at;
      }
      if (primary.reply_count == null && secondary.reply_count != null) {
        primary.reply_count = secondary.reply_count;
      }
      if (primary.repost_count == null && secondary.repost_count != null) {
        primary.repost_count = secondary.repost_count;
      }
      if (primary.like_count == null && secondary.like_count != null) {
        primary.like_count = secondary.like_count;
      }
      if (primary.bookmark_count == null && secondary.bookmark_count != null) {
        primary.bookmark_count = secondary.bookmark_count;
      }
      if (primary.views_count == null && secondary.views_count != null) {
        primary.views_count = secondary.views_count;
      }
      if (!primary.status_url && secondary.status_url) {
        primary.status_url = secondary.status_url;
      }
      if (!primary.quoted_status_id && secondary.quoted_status_id) {
        primary.quoted_status_id = secondary.quoted_status_id;
      }
      if (!primary.quoted_status_url && secondary.quoted_status_url) {
        primary.quoted_status_url = secondary.quoted_status_url;
      }
      if (!primary.in_reply_to_status_id && secondary.in_reply_to_status_id) {
        primary.in_reply_to_status_id = secondary.in_reply_to_status_id;
      }
      if (!primary.in_reply_to_screen_name && secondary.in_reply_to_screen_name) {
        primary.in_reply_to_screen_name = secondary.in_reply_to_screen_name;
      }
      primary.url_entities = mergeUrlEntityLists(primary.url_entities, secondary.url_entities);

      bestByStatus.set(summary.status_id, primary);
    }
    return bestByStatus;
  }

  function buildStatusInfoById(bestByStatus, signalUrls) {
    const statusInfoById = new Map();

    function upsertStatusInfo(parts) {
      if (!parts || !parts.status_id) {
        return;
      }
      const existing = statusInfoById.get(parts.status_id) || {
        status_id: parts.status_id,
        handle: null,
        status_url: null,
      };
      if (!existing.handle && parts.handle) {
        existing.handle = parts.handle;
      }
      if (!existing.status_url && parts.status_url) {
        existing.status_url = parts.status_url;
      } else if (
        existing.status_url &&
        parts.status_url &&
        !isHandleStatusUrl(existing.status_url) &&
        isHandleStatusUrl(parts.status_url)
      ) {
        existing.status_url = parts.status_url;
      }
      statusInfoById.set(parts.status_id, existing);
    }

    for (const url of uniq(signalUrls || [])) {
      upsertStatusInfo(parseStatusUrlParts(url));
    }
    for (const summary of bestByStatus.values()) {
      upsertStatusInfo(parseStatusUrlParts(summary.status_url));
      if (summary.quoted_status_url) {
        upsertStatusInfo(parseStatusUrlParts(summary.quoted_status_url));
      }
      if (summary.status_id && summary.author_handle) {
        upsertStatusInfo({
          status_id: summary.status_id,
          handle: summary.author_handle,
          status_url: `https://x.com/${summary.author_handle}/status/${summary.status_id}`,
        });
      }
      if (summary.in_reply_to_status_id && summary.in_reply_to_screen_name) {
        upsertStatusInfo({
          status_id: summary.in_reply_to_status_id,
          handle: summary.in_reply_to_screen_name,
          status_url: `https://x.com/${summary.in_reply_to_screen_name}/status/${summary.in_reply_to_status_id}`,
        });
      }
    }

    return statusInfoById;
  }

  function collectPayloadSummaryAndStatusIndex(article) {
    const payloads = collectReactPayloads(article);
    if (payloads.length === 0) {
      return null;
    }

    const summaries = [];
    const signalUrls = [];
    for (const payload of payloads) {
      try {
        const signals = collectStatusSignalsFromValue(payload);
        signalUrls.push(...signals.urls);
      } catch (_error) {
        // ignore malformed payload fragments
      }
      try {
        summaries.push(...collectTweetNodeSummaries(payload));
      } catch (_error) {
        // ignore malformed payload fragments
      }
    }

    if (summaries.length === 0) {
      return null;
    }

    const bestByStatus = buildBestSummaryByStatus(summaries);
    const statusInfoById = buildStatusInfoById(bestByStatus, signalUrls);

    return {
      best_by_status: bestByStatus,
      status_info_by_id: statusInfoById,
    };
  }

  function extractQuotedItemsFromReactPayload(article, ownStatusId) {
    const payloadIndex = collectPayloadSummaryAndStatusIndex(article);
    if (!payloadIndex) {
      return [];
    }
    const bestByStatus = payloadIndex.best_by_status;
    const statusInfoById = payloadIndex.status_info_by_id;

    const primary = bestByStatus.get(ownStatusId) || null;
    const quotedIds = [];
    if (primary && primary.quoted_status_id) {
      quotedIds.push(primary.quoted_status_id);
    }
    if (primary && primary.quoted_status_url) {
      const id = parseStatusId(primary.quoted_status_url);
      if (id) {
        quotedIds.push(id);
      }
    }

    if (quotedIds.length === 0) {
      const onlyOtherIds = Array.from(bestByStatus.keys()).filter((id) => id !== ownStatusId);
      if (onlyOtherIds.length === 1) {
        quotedIds.push(onlyOtherIds[0]);
      }
    }

    const uniqueQuotedIds = uniq(quotedIds);
    if (uniqueQuotedIds.length === 0) {
      return [];
    }

    const knownNameByHandle = new Map();
    const ownAuthor = extractUserInfo(article);
    if (ownAuthor && ownAuthor.handle && ownAuthor.display_name) {
      knownNameByHandle.set(ownAuthor.handle.toLowerCase(), ownAuthor.display_name);
    }
    for (const summary of bestByStatus.values()) {
      if (summary.author_handle && summary.author_name) {
        knownNameByHandle.set(summary.author_handle.toLowerCase(), summary.author_name);
      }
    }

    const items = [];
    for (const quotedId of uniqueQuotedIds) {
      const quoted = bestByStatus.get(quotedId) || null;
      const statusInfo = statusInfoById.get(quotedId) || null;
      const handle =
        (quoted && quoted.author_handle) || (statusInfo && statusInfo.handle) || null;
      const displayName =
        (quoted && quoted.author_name) ||
        (handle ? knownNameByHandle.get(handle.toLowerCase()) || null : null);
      const statusUrl =
        (statusInfo && statusInfo.status_url) ||
        (quoted && quoted.status_url) ||
        (handle
          ? `https://x.com/${handle}/status/${quotedId}`
          : `https://x.com/i/web/status/${quotedId}`);
      items.push({
        type: "tweet",
        status_id: quotedId,
        status_url: statusUrl,
        author: {
          handle,
          handle_text: handle ? `@${handle}` : null,
          display_name: displayName,
        },
        text: quoted ? quoted.text || null : null,
        article: null,
      });
    }

    return items;
  }

  function extractReplyHandleFromSocialContext(socialContext) {
    const text = String(socialContext || "");
    const match = text.match(/@[A-Za-z0-9_]+/);
    if (!match) {
      return null;
    }
    return normalizeHandle(match[0]);
  }

  function extractReplyToInfo(article, ownStatusId, socialContext) {
    const payloadIndex = collectPayloadSummaryAndStatusIndex(article);
    const replyHandleFromContext = extractReplyHandleFromSocialContext(socialContext);

    if (!payloadIndex) {
      if (!replyHandleFromContext) {
        return null;
      }
      return {
        status_id: null,
        status_url: null,
        handle: replyHandleFromContext,
        handle_text: `@${replyHandleFromContext}`,
        source: "social_context",
      };
    }

    const bestByStatus = payloadIndex.best_by_status;
    const statusInfoById = payloadIndex.status_info_by_id;
    const primary = bestByStatus.get(ownStatusId) || null;

    let replyStatusId = primary && primary.in_reply_to_status_id ? primary.in_reply_to_status_id : null;
    let replyHandle =
      (primary && primary.in_reply_to_screen_name) || replyHandleFromContext || null;

    if (!replyHandle && replyStatusId) {
      const info = statusInfoById.get(replyStatusId) || null;
      if (info && info.handle) {
        replyHandle = info.handle;
      }
    }

    if (!replyStatusId && !replyHandle) {
      return null;
    }

    let replyStatusUrl = null;
    if (replyStatusId) {
      const info = statusInfoById.get(replyStatusId) || null;
      replyStatusUrl =
        (info && info.status_url) ||
        (replyHandle
          ? `https://x.com/${replyHandle}/status/${replyStatusId}`
          : `https://x.com/i/web/status/${replyStatusId}`);
    }

    return {
      status_id: replyStatusId || null,
      status_url: replyStatusUrl || null,
      handle: replyHandle || null,
      handle_text: replyHandle ? `@${replyHandle}` : null,
      source: replyStatusId ? "react_payload" : "social_context",
    };
  }

  function extractMentionHandles(input) {
    const text = input || "";
    const matches = text.match(/@[A-Za-z0-9_]+/g) || [];
    return uniq(matches.map((value) => value.slice(1).toLowerCase()));
  }

  function getCanonicalStatusId() {
    const canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical || !canonical.href) {
      return null;
    }
    return parseStatusId(canonical.href) || parseArticleId(canonical.href);
  }

  function uniq(items) {
    return Array.from(new Set(items.filter(Boolean)));
  }

  function getScopedNodes(root, selector, ownerArticle) {
    const nodes = Array.from(root.querySelectorAll(selector));
    if (!ownerArticle) {
      return nodes;
    }
    return nodes.filter((node) => {
      const nearestArticle = node.closest('article[data-testid="tweet"]');
      return nearestArticle === ownerArticle;
    });
  }

  function getFirstScopedNode(root, selector, ownerArticle) {
    const nodes = getScopedNodes(root, selector, ownerArticle);
    return nodes.length > 0 ? nodes[0] : null;
  }

  function getScopedLinks(root, selector, ownerArticle) {
    return getScopedNodes(root, selector, ownerArticle);
  }

  function getScopedStatusLinks(root, ownerArticle) {
    return getScopedLinks(root, STATUS_LINK_SELECTOR, ownerArticle);
  }

  function getScopedArticleLinks(root, ownerArticle) {
    return getScopedLinks(root, ARTICLE_LINK_SELECTOR, ownerArticle);
  }

  function findCanonicalArticleMatch(canonicalId, root) {
    const safeCanonicalId = normalizeStatusId(canonicalId);
    if (!safeCanonicalId) {
      return null;
    }

    const refPattern = new RegExp(`\\/(?:status|article)\\/${safeCanonicalId}(?:$|[/?#])`);
    const candidates = [];
    const articlePrimaryRefCache = new Map();
    const links = Array.from((root || document).querySelectorAll("a[href]"));

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (!refPattern.test(href)) {
        continue;
      }

      const article = link.closest(TWEET_SELECTOR);
      if (!article) {
        continue;
      }

      const hasTime = Boolean(link.querySelector("time[datetime]"));
      const inSocialContext = Boolean(link.closest(SOCIAL_CONTEXT_SELECTOR));
      const inUserName = Boolean(link.closest(USER_NAME_SELECTOR));
      const statusSuffixMatch = /\/status\/\d+\/(photo|video|analytics|quotes)(?:$|[/?#])/.test(href);
      const articleSuffixMatch = /\/article\/\d+\/media(?:$|[/?#])/.test(href);
      const hasSuffix = statusSuffixMatch || articleSuffixMatch;

      let score = 0;
      if (hasTime) {
        score += 170;
      }
      if (!hasSuffix) {
        score += 30;
      }
      if (/\/(?:status|article)\/\d+(?:$|[?#])/.test(href)) {
        score += 25;
      }
      if (article.querySelector(TWEET_TEXT_SELECTOR)) {
        score += 8;
      }
      if (inSocialContext) {
        score -= 90;
      }
      if (inUserName) {
        score -= 45;
      }
      if (link.closest('[data-testid="tweetText"]')) {
        score -= 15;
      }

      if (!articlePrimaryRefCache.has(article)) {
        articlePrimaryRefCache.set(article, findPrimaryStatusRef(article));
      }
      const primaryRef = articlePrimaryRefCache.get(article);
      if (primaryRef && primaryRef.status_id === safeCanonicalId) {
        score += 110;
      } else if (primaryRef && primaryRef.status_id) {
        score -= 35;
      }

      candidates.push({
        article,
        link,
        href,
        score,
        has_time: hasTime,
      });
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => b.score - a.score);
    if (candidates[0].score < 70) {
      return null;
    }
    const best = candidates[0];
    return {
      article: best.article,
      status_url: toAbsoluteUrl(best.href),
      score: best.score,
      has_time: best.has_time,
    };
  }

  function findPrimaryStatusRef(article) {
    const statusLinks = getScopedStatusLinks(article, article);
    for (const link of statusLinks) {
      const href = link.getAttribute("href") || "";
      if (!STATUS_LINK_PATTERN.test(href)) {
        continue;
      }
      if (/\/status\/\d+\/(photo|video|analytics|quotes)/.test(href)) {
        continue;
      }
      const statusId = parseStatusId(href);
      if (!statusId) {
        continue;
      }
      const statusRef = parseStatusRefFromHref(href);
      return {
        status_id: statusId,
        status_url: statusRef ? statusRef.status_url : toAbsoluteUrl(href),
      };
    }

    for (const link of statusLinks) {
      const href = link.getAttribute("href") || "";
      if (!STATUS_LINK_PATTERN.test(href)) {
        continue;
      }
      if (/\/status\/\d+\/(photo|video)/.test(href)) {
        continue;
      }
      const statusId = parseStatusId(href);
      if (!statusId) {
        continue;
      }
      const statusRef = parseStatusRefFromHref(href);
      return {
        status_id: statusId,
        status_url: statusRef ? statusRef.status_url : toAbsoluteUrl(href),
      };
    }

    const articleLinks = getScopedArticleLinks(article, article);
    for (const link of articleLinks) {
      const href = link.getAttribute("href") || "";
      if (!ARTICLE_LINK_PATTERN.test(href)) {
        continue;
      }
      if (/\/article\/\d+\/media/.test(href)) {
        continue;
      }
      const articleId = parseArticleId(href);
      if (!articleId) {
        continue;
      }
      return {
        status_id: articleId,
        status_url: toAbsoluteUrl(href),
      };
    }
    return null;
  }

  function normalizeHttpUrlCandidate(input) {
    const raw = firstString([input]);
    if (!raw) {
      return null;
    }
    const absolute = toAbsoluteUrl(raw.trim());
    if (!absolute) {
      return null;
    }
    try {
      const parsed = new URL(absolute);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return null;
      }
      parsed.hash = "";
      return parsed.toString();
    } catch (_error) {
      return null;
    }
  }

  function isTcoShortUrl(input) {
    const normalized = normalizeHttpUrlCandidate(input);
    if (!normalized) {
      return false;
    }
    try {
      const parsed = new URL(normalized);
      return /^t\.co$/i.test(parsed.hostname);
    } catch (_error) {
      return false;
    }
  }

  function pickTargetTweet(articles) {
    const canonicalId = getCanonicalStatusId();
    let fallback = null;
    const foundStatusIds = [];

    for (const article of articles) {
      const primaryRef = findPrimaryStatusRef(article);
      if (!primaryRef || !primaryRef.status_id) {
        continue;
      }
      const statusId = primaryRef.status_id;
      foundStatusIds.push(statusId);
      const candidate = {
        article,
        statusId,
        statusUrl: primaryRef.status_url || null,
      };
      if (canonicalId && statusId === canonicalId) {
        return candidate;
      }
      if (!fallback) {
        fallback = candidate;
      }
    }

    if (canonicalId) {
      const canonicalMatch = findCanonicalArticleMatch(canonicalId, document);
      if (canonicalMatch) {
        return {
          article: canonicalMatch.article,
          statusId: canonicalId,
          statusUrl: canonicalMatch.status_url,
          canonical_match_score: canonicalMatch.score,
          canonical_match_has_time: canonicalMatch.has_time,
        };
      }
    }

    if (canonicalId) {
      return {
        error: `Canonical status_id ${canonicalId} was not found in tweet articles. Found: ${foundStatusIds.join(", ") || "none"}`,
        error_code: "canonical_not_found",
        canonical_id: canonicalId,
        found_status_ids: foundStatusIds,
      };
    }

    return fallback;
  }

  function sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function findMutedWarningRoots() {
    const nodes = Array.from(document.querySelectorAll("span,div,p"));
    const roots = [];
    for (const node of nodes) {
      const text = normalizeWhitespace(nodeText(node));
      if (!text || !MUTED_WARNING_PATTERN.test(text)) {
        continue;
      }
      const root =
        node.closest('[role="button"]') ||
        node.closest("button") ||
        node.closest('[data-testid="cellInnerDiv"]') ||
        node.closest("article") ||
        node.parentElement;
      if (root) {
        roots.push(root);
      }
    }
    return uniq(roots);
  }

  function collectRevealCandidates(root) {
    const candidates = [];
    if (!root) {
      return candidates;
    }

    const selfText = normalizeWhitespace(nodeText(root));
    if (/^(表示|Show|View|Expand|展開)$/i.test(selfText) || MUTED_WARNING_PATTERN.test(selfText)) {
      candidates.push(root);
    }

    const clickable = Array.from(
      root.querySelectorAll('button,[role="button"],a[role="button"],div[role="button"]')
    );
    for (const node of clickable) {
      const text = normalizeWhitespace(nodeText(node));
      if (!text) {
        continue;
      }
      if (
        /表示|Show|View|Expand|展開|Reveal|見る|See/i.test(text) ||
        MUTED_WARNING_PATTERN.test(text)
      ) {
        candidates.push(node);
      }
    }

    return uniq(candidates);
  }

  function tryRevealMutedTweetBlocks() {
    const roots = findMutedWarningRoots();
    if (roots.length === 0) {
      return 0;
    }

    let clicked = 0;
    const seen = new Set();
    for (const root of roots) {
      const candidates = collectRevealCandidates(root);
      for (const node of candidates) {
        if (!node || seen.has(node)) {
          continue;
        }
        seen.add(node);
        try {
          node.click();
          clicked += 1;
        } catch (_error) {
          // ignore
        }
      }
    }

    return clicked;
  }

  function findSectionHeading(article) {
    const cell = article.closest('[data-testid="cellInnerDiv"]');
    if (!cell || !cell.parentElement) {
      return null;
    }

    const sectionLabelPattern =
      /会話|conversation|返信|repl|もっと見つける|more to explore|xから|from x|関連|related|おすすめ|for you|discover/i;

    let probe = cell.previousElementSibling;
    let hops = 0;
    while (probe && hops < 24) {
      hops += 1;
      const heading = probe.querySelector('h1, h2, h3, [role="heading"]');
      if (heading) {
        if (heading.closest(ARTICLE_READ_VIEW_SELECTOR) || heading.closest('[data-block="true"]')) {
          probe = probe.previousElementSibling;
          continue;
        }
        const text = normalizeWhitespace(nodeText(heading));
        if (text && sectionLabelPattern.test(text)) {
          return text;
        }
      }
      probe = probe.previousElementSibling;
    }

    return null;
  }

  function findTimelineLabel(article) {
    let current = article.parentElement;
    while (current) {
      if (typeof current.getAttribute === "function") {
        const label = current.getAttribute("aria-label");
        if (label && /タイムライン|timeline|会話|conversation|もっと見つける|more to explore|xから|from x|関連|related|おすすめ|for you|discover/i.test(label)) {
          return normalizeWhitespace(label);
        }
      }
      current = current.parentElement;
    }
    return null;
  }

  function extractSocialContext(article) {
    const root = article.querySelector(SOCIAL_CONTEXT_SELECTOR);
    if (!root) {
      return null;
    }
    const text = normalizeWhitespace(nodeText(root));
    return text || null;
  }

  function collectStatusRefs(article) {
    return uniq(
      getScopedStatusLinks(article, article)
        .map((link) => parseStatusId(link.getAttribute("href") || ""))
        .filter(Boolean)
    );
  }

  function pickStatusFromRoot(root, ownStatusId) {
    const ownerArticle = root.closest('article[data-testid="tweet"]') || null;
    const links = getScopedStatusLinks(root, ownerArticle);
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (/\/status\/\d+\/(photo|video|analytics|quotes)/.test(href)) {
        continue;
      }
      const statusId = parseStatusId(href);
      if (!statusId || statusId === ownStatusId) {
        continue;
      }
      const statusRef = parseStatusRefFromHref(href);
      return {
        status_id: statusId,
        status_url: statusRef ? statusRef.status_url : toAbsoluteUrl(href),
      };
    }
    return {
      status_id: null,
      status_url: null,
    };
  }

  function extractArticleCardMeta(root, preferredHandle) {
    const badge = root.querySelector('[aria-label="記事"], [aria-label="Article"]');
    if (!badge) {
      return null;
    }

    let probe = badge;
    let hops = 0;
    while (probe && probe.parentElement && probe.parentElement.children.length < 2 && hops < 6) {
      probe = probe.parentElement;
      hops += 1;
    }

    let title = null;
    let excerpt = null;
    if (probe && probe.parentElement) {
      const siblings = Array.from(probe.parentElement.children);
      const idx = siblings.indexOf(probe);
      const textCandidates = siblings
        .slice(idx + 1)
        .map((el) => normalizeWhitespace(nodeText(el)))
        .filter(Boolean)
        .filter((text) => text !== "記事" && text !== "Article");
      if (textCandidates.length > 0) {
        title = textCandidates[0] || null;
      }
      if (textCandidates.length > 1) {
        excerpt = textCandidates[1] || null;
      }
    }

    let url = null;
    let statusId = null;
    let statusUrl = null;
    let urlSource = null;
    let urlUnavailableReason = null;
    const links = Array.from(root.querySelectorAll("a[href]"));
    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (!href || /\/status\//.test(href)) {
        continue;
      }
      if (/^\/[A-Za-z0-9_]+(?:$|[?#])/.test(href)) {
        continue;
      }
      url = toAbsoluteUrl(href);
      if (url) {
        urlSource = "dom_anchor";
      }
      break;
    }

    const inferred = inferStatusFromReactPayload(root, preferredHandle);
    if (!statusId && inferred.status_id) {
      statusId = inferred.status_id;
    }
    if (!statusUrl && inferred.status_url) {
      statusUrl = inferred.status_url;
    }

    if (!url && statusUrl) {
      url = statusUrl;
      urlSource = "react_payload";
    }

    if (!statusId && url) {
      statusId = parseStatusId(url);
    }
    if (!statusUrl && statusId) {
      statusUrl = preferredHandle
        ? `https://x.com/${preferredHandle}/status/${statusId}`
        : `https://x.com/i/web/status/${statusId}`;
    }

    if (!url) {
      const noAnchorReason =
        links.length === 0
          ? "no_href_in_quote_card_dom"
          : "no_resolvable_quote_card_url_in_dom";
      urlUnavailableReason = inferred.probe_error
        ? `${noAnchorReason}+react_payload_probe_failed`
        : noAnchorReason;
    }

    return {
      kind: "article",
      title,
      excerpt,
      url,
      status_id: statusId,
      status_url: statusUrl,
      url_source: urlSource,
      url_unavailable_reason: urlUnavailableReason,
    };
  }

  function collectQuoteRoots(article) {
    const roots = [];
    const labels = Array.from(article.querySelectorAll("span,div")).filter((el) => {
      const text = normalizeWhitespace(nodeText(el));
      return text === "引用" || text === "Quote";
    });

    for (const label of labels) {
      const root =
        label.closest('[aria-labelledby]') ||
        label.closest('[role="link"]') ||
        label.closest("div");
      if (!root) {
        continue;
      }
      roots.push(root);
    }

    return uniq(roots);
  }

  function normalizeQuotedAuthor(author) {
    if (!author || typeof author !== "object") {
      return {
        handle: null,
        handle_text: null,
        display_name: null,
      };
    }
    const handle = normalizeHandle(author.handle);
    const handleText =
      firstString([author.handle_text]) || (handle ? `@${handle}` : null);
    const displayName = firstString([author.display_name]) || null;
    return {
      handle,
      handle_text: handleText,
      display_name: displayName,
    };
  }

  function normalizeQuotedItem(item) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const type = item.type === "article" ? "article" : "tweet";
    const statusId = normalizeStatusId(item.status_id);
    const rawStatusUrl = firstString([item.status_url]);
    const statusUrl =
      type === "tweet"
        ? normalizeStatusUrlCandidate(rawStatusUrl) || (rawStatusUrl ? toAbsoluteUrl(rawStatusUrl) : null)
        : rawStatusUrl
        ? toAbsoluteUrl(rawStatusUrl) || rawStatusUrl
        : null;
    const text = firstString([item.text]) || null;
    const author = normalizeQuotedAuthor(item.author);
    const articleMeta =
      item.article && typeof item.article === "object"
        ? {
            title: firstString([item.article.title]) || null,
            excerpt: firstString([item.article.excerpt]) || null,
            url: firstString([item.article.url]) || null,
            url_source: firstString([item.article.url_source]) || null,
            url_unavailable_reason: firstString([item.article.url_unavailable_reason]) || null,
          }
        : null;

    return {
      type,
      status_id: statusId || null,
      status_url: statusUrl || null,
      author,
      text,
      article: articleMeta,
    };
  }

  function quotedItemDedupeKey(item) {
    if (!item) {
      return null;
    }
    if (item.status_id) {
      return `status:${item.status_id}`;
    }
    if (item.type === "article" && item.article && item.article.url) {
      return `article:${item.article.url}`;
    }
    if (item.status_url) {
      return `status_url:${item.status_url}`;
    }
    return JSON.stringify([
      item.type,
      item.author && item.author.handle,
      item.text,
      item.article && item.article.title,
    ]);
  }

  function scoreQuotedItem(item) {
    if (!item) {
      return 0;
    }
    let score = 0;
    if (item.status_id) {
      score += 8;
    }
    if (item.status_url) {
      score += 5;
    }
    if (item.author && item.author.handle) {
      score += 4;
    }
    if (item.author && item.author.display_name) {
      score += 2;
    }
    if (item.text) {
      score += Math.min(item.text.length, 240) / 40;
    }
    if (item.article && item.article.url) {
      score += 3;
    }
    if (item.article && item.article.title) {
      score += 2;
    }
    return score;
  }

  function mergeQuotedItems(left, right) {
    const a = normalizeQuotedItem(left);
    const b = normalizeQuotedItem(right);
    if (!a) {
      return b;
    }
    if (!b) {
      return a;
    }

    const aScore = scoreQuotedItem(a);
    const bScore = scoreQuotedItem(b);
    const primary = aScore >= bScore ? { ...a } : { ...b };
    const secondary = aScore >= bScore ? b : a;

    if (!primary.status_id && secondary.status_id) {
      primary.status_id = secondary.status_id;
    }
    if (!primary.status_url && secondary.status_url) {
      primary.status_url = secondary.status_url;
    }
    if (!primary.text && secondary.text) {
      primary.text = secondary.text;
    }
    if (!primary.author || typeof primary.author !== "object") {
      primary.author = {
        handle: null,
        handle_text: null,
        display_name: null,
      };
    }
    if (secondary.author && typeof secondary.author === "object") {
      if (!primary.author.handle && secondary.author.handle) {
        primary.author.handle = secondary.author.handle;
      }
      if (!primary.author.handle_text && secondary.author.handle_text) {
        primary.author.handle_text = secondary.author.handle_text;
      }
      if (!primary.author.display_name && secondary.author.display_name) {
        primary.author.display_name = secondary.author.display_name;
      }
    }
    if (!primary.author.handle_text && primary.author.handle) {
      primary.author.handle_text = `@${primary.author.handle}`;
    }

    if (!primary.article && secondary.article) {
      primary.article = { ...secondary.article };
    } else if (primary.article && secondary.article) {
      if (!primary.article.title && secondary.article.title) {
        primary.article.title = secondary.article.title;
      }
      if (!primary.article.excerpt && secondary.article.excerpt) {
        primary.article.excerpt = secondary.article.excerpt;
      }
      if (!primary.article.url && secondary.article.url) {
        primary.article.url = secondary.article.url;
      }
      if (!primary.article.url_source && secondary.article.url_source) {
        primary.article.url_source = secondary.article.url_source;
      }
      if (!primary.article.url_unavailable_reason && secondary.article.url_unavailable_reason) {
        primary.article.url_unavailable_reason = secondary.article.url_unavailable_reason;
      }
    }

    return primary;
  }

  function extractQuotedItems(article, ownStatusId) {
    const roots = collectQuoteRoots(article);
    const items = [];
    const itemIndexByKey = new Map();
    function pushQuotedItem(item) {
      const normalized = normalizeQuotedItem(item);
      if (!normalized) {
        return;
      }
      const dedupeKey = quotedItemDedupeKey(normalized);
      if (!dedupeKey) {
        return;
      }
      if (!itemIndexByKey.has(dedupeKey)) {
        itemIndexByKey.set(dedupeKey, items.length);
        items.push(normalized);
        return;
      }
      const index = itemIndexByKey.get(dedupeKey);
      items[index] = mergeQuotedItems(items[index], normalized);
    }

    for (const root of roots) {
      let item = null;
      try {
        const quoteUser = extractUserInfo(root);
        const articleMeta = extractArticleCardMeta(root, quoteUser && quoteUser.handle);
        const statusInfo = pickStatusFromRoot(root, ownStatusId);
        let statusId = statusInfo.status_id;
        let statusUrl = statusInfo.status_url;
        if (!statusId && articleMeta && articleMeta.status_id) {
          statusId = articleMeta.status_id;
        }
        if (!statusUrl && articleMeta && articleMeta.status_url) {
          statusUrl = articleMeta.status_url;
        }
        const quoteTextRoot = root.querySelector(TWEET_TEXT_SELECTOR);
        const quoteText = quoteTextRoot ? normalizeWhitespace(nodeText(quoteTextRoot)) : null;
        const type = articleMeta ? "article" : "tweet";
        item = {
          type,
          status_id: statusId,
          status_url: statusUrl,
          author: quoteUser,
          text: quoteText || null,
          article: articleMeta
            ? {
                title: articleMeta.title || null,
                excerpt: articleMeta.excerpt || null,
                url: articleMeta.url || null,
                url_source: articleMeta.url_source || null,
                url_unavailable_reason: articleMeta.url_unavailable_reason || null,
              }
            : null,
        };
      } catch (_error) {
        continue;
      }
      if (!item) {
        continue;
      }
      pushQuotedItem(item);
    }

    const embeddedTweetItems = extractEmbeddedTweetQuoteItems(article, ownStatusId);
    for (const embeddedItem of embeddedTweetItems) {
      pushQuotedItem(embeddedItem);
    }

    const needsPayloadFallback =
      roots.length === 0 ||
      items.every(
        (item) =>
          !item.status_id &&
          !(item.article && item.article.url) &&
          !(item.article && item.article.status_id)
      );
    if (needsPayloadFallback) {
      const payloadItems = extractQuotedItemsFromReactPayload(article, ownStatusId);
      for (const payloadItem of payloadItems) {
        pushQuotedItem(payloadItem);
      }
    }

    const articleReadViewRefs = extractArticleReadViewReferencedTweets(article, ownStatusId);
    for (const refItem of articleReadViewRefs) {
      pushQuotedItem(refItem);
    }

    return items;
  }

  function extractEmbeddedTweetQuoteItems(article, ownStatusId) {
    const embeddedArticles = Array.from(article.querySelectorAll(TWEET_SELECTOR)).filter(
      (node) => node !== article
    );
    if (embeddedArticles.length === 0) {
      return [];
    }

    const out = [];
    const seenStatusIds = new Set();
    for (const embedded of embeddedArticles) {
      const primaryRef = findPrimaryStatusRef(embedded);
      if (!primaryRef || !primaryRef.status_id) {
        continue;
      }
      const statusId = primaryRef.status_id;
      if (statusId === ownStatusId || seenStatusIds.has(statusId)) {
        continue;
      }
      seenStatusIds.add(statusId);

      const author = extractUserInfo(embedded);
      const statusUrl =
        primaryRef.status_url ||
        buildHandleStatusUrl(author && author.handle, statusId) ||
        `https://x.com/i/web/status/${statusId}`;

      out.push({
        type: "tweet",
        status_id: statusId,
        status_url: statusUrl,
        author: author || {
          handle: null,
          handle_text: null,
          display_name: null,
        },
        text: extractText(embedded, statusId),
        article: null,
      });
    }

    return out;
  }

  function extractArticleReadViewReferencedTweets(article, ownStatusId) {
    const readView = getFirstScopedNode(article, ARTICLE_READ_VIEW_SELECTOR, article);
    if (!readView) {
      return [];
    }

    const payloadIndex = collectPayloadSummaryAndStatusIndex(article);
    const bestByStatus = payloadIndex ? payloadIndex.best_by_status : null;
    const statusInfoById = payloadIndex ? payloadIndex.status_info_by_id : null;
    const items = [];
    const seenStatusIds = new Set();
    const links = Array.from(readView.querySelectorAll('a[href*="/status/"]'));

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (!href || /\/status\/\d+\/(photo|video|analytics|quotes)(?:$|[/?#])/i.test(href)) {
        continue;
      }
      const statusId = parseStatusId(href);
      if (!statusId || statusId === ownStatusId || seenStatusIds.has(statusId)) {
        continue;
      }
      seenStatusIds.add(statusId);

      const summary = bestByStatus ? bestByStatus.get(statusId) || null : null;
      const statusInfo = statusInfoById ? statusInfoById.get(statusId) || null : null;
      const handle = normalizeHandle(
        firstString([
          summary && summary.author_handle,
          statusInfo && statusInfo.handle,
        ])
      );
      const statusUrl =
        (statusInfo && statusInfo.status_url) ||
        (summary && summary.status_url) ||
        normalizeStatusUrlCandidate(href) ||
        buildHandleStatusUrl(handle, statusId) ||
        `https://x.com/i/web/status/${statusId}`;

      items.push({
        type: "tweet",
        status_id: statusId,
        status_url: statusUrl,
        author: {
          handle: handle || null,
          handle_text: handle ? `@${handle}` : null,
          display_name: (summary && summary.author_name) || null,
        },
        text: (summary && summary.text) || null,
        article: null,
      });
    }

    return items;
  }

  function extractUserInfo(article) {
    const ownerArticle =
      article && article.matches && article.matches(TWEET_SELECTOR)
        ? article
        : article
        ? article.closest(TWEET_SELECTOR)
        : null;
    const userRoot = ownerArticle
      ? getFirstScopedNode(ownerArticle, USER_NAME_SELECTOR, ownerArticle)
      : article.querySelector(USER_NAME_SELECTOR);
    if (!userRoot) {
      return {
        handle: null,
        handle_text: null,
        display_name: null,
      };
    }

    const spanTexts = Array.from(userRoot.querySelectorAll("span"))
      .map((span) => normalizeWhitespace(span.textContent))
      .filter(Boolean);

    let handleText = spanTexts.find((text) => text.startsWith("@")) || null;
    let displayName = spanTexts.find((text) => !text.startsWith("@") && text !== "·") || null;
    let handle = handleText ? handleText.replace(/^@/, "") : null;

    if (!handle) {
      const handleHref = Array.from(userRoot.querySelectorAll('a[href^="/"]'))
        .map((a) => a.getAttribute("href") || "")
        .find((href) => /^\/[^/?#]+$/.test(href));
      if (handleHref) {
        handle = handleHref.slice(1);
        handleText = `@${handle}`;
      }
    }

    return {
      handle,
      handle_text: handleText,
      display_name: displayName,
    };
  }

  function normalizeDisplayUrlCandidate(input) {
    const raw = firstString([input]);
    if (!raw) {
      return null;
    }
    return raw.replace(/\s+/g, "");
  }

  function getPayloadSummaryForStatus(article, statusId) {
    const safeStatusId = normalizeStatusId(statusId);
    if (!safeStatusId) {
      return null;
    }
    const payloadIndex = collectPayloadSummaryAndStatusIndex(article);
    const bestByStatus = payloadIndex && payloadIndex.best_by_status ? payloadIndex.best_by_status : null;
    if (!bestByStatus) {
      return null;
    }
    return bestByStatus.get(safeStatusId) || null;
  }

  function collectTweetLinksFromSummary(summary) {
    const out = [];
    const seen = new Set();
    if (!summary || !Array.isArray(summary.url_entities)) {
      return out;
    }

    for (const entity of summary.url_entities) {
      if (!entity || typeof entity !== "object") {
        continue;
      }
      const shortUrl = normalizeHttpUrlCandidate(
        firstString([
          entity.short_url,
          entity.url,
        ])
      );
      const expandedUrl =
        normalizeHttpUrlCandidate(
          firstString([
            entity.expanded_url,
            entity.expanded,
            entity.unwound_url,
          ])
        ) || shortUrl;
      if (!expandedUrl) {
        continue;
      }
      const key = `${expandedUrl}\n${shortUrl || ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push({
        expanded_url: expandedUrl,
        short_url: shortUrl || null,
        display_url: normalizeDisplayUrlCandidate(entity.display_url),
      });
    }

    return out;
  }

  function buildExpandedUrlMapForStatus(article, statusId, summaryOverride) {
    const summary = summaryOverride || getPayloadSummaryForStatus(article, statusId);
    if (!summary) {
      return new Map();
    }
    const out = new Map();

    for (const link of collectTweetLinksFromSummary(summary)) {
      if (!link.short_url || !link.expanded_url) {
        continue;
      }
      out.set(link.short_url, link.expanded_url);
    }

    return out;
  }

  function extractTweetLinks(article, statusId, summaryOverride) {
    const summary = summaryOverride || getPayloadSummaryForStatus(article, statusId);
    const summaryLinks = collectTweetLinksFromSummary(summary);
    const byShort = new Map();
    const byExpanded = new Map();
    for (const link of summaryLinks) {
      if (link.short_url) {
        byShort.set(link.short_url, link);
      }
      byExpanded.set(link.expanded_url, link);
    }

    const out = [];
    const seen = new Set();
    const pushLink = (link) => {
      if (!link || !link.expanded_url) {
        return;
      }
      const key = `${link.expanded_url}\n${link.short_url || ""}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      out.push({
        expanded_url: link.expanded_url,
        short_url: link.short_url || null,
        display_url: link.display_url || null,
      });
    };

    const textRoot = article ? getFirstScopedNode(article, TWEET_TEXT_SELECTOR, article) : null;
    if (textRoot) {
      const anchors = Array.from(textRoot.querySelectorAll("a[href]"));
      for (const anchor of anchors) {
        const href = normalizeHttpUrlCandidate(anchor.getAttribute("href"));
        if (!href) {
          continue;
        }
        const fromSummary = byShort.get(href) || byExpanded.get(href) || null;
        const expandedUrl = fromSummary
          ? fromSummary.expanded_url
          : href;
        const shortUrl = fromSummary
          ? fromSummary.short_url
          : isTcoShortUrl(href)
          ? href
          : null;
        const displayUrl =
          (fromSummary && fromSummary.display_url) ||
          normalizeDisplayUrlCandidate(nodeText(anchor));
        pushLink({
          expanded_url: expandedUrl,
          short_url: shortUrl,
          display_url: displayUrl,
        });
      }
    }

    for (const link of summaryLinks) {
      pushLink(link);
    }

    return out;
  }

  function renderTweetTextNode(node, expandedUrlByShort) {
    if (!node) {
      return "";
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const tag = String(node.tagName || "").toLowerCase();
    if (tag === "img") {
      return node.getAttribute("alt") || "";
    }
    if (tag === "br") {
      return "\n";
    }
    if (tag === "a") {
      const href = normalizeHttpUrlCandidate(node.getAttribute("href"));
      if (href && isTcoShortUrl(href) && expandedUrlByShort && expandedUrlByShort.has(href)) {
        return expandedUrlByShort.get(href) || "";
      }
    }

    let output = "";
    for (const child of node.childNodes) {
      output += renderTweetTextNode(child, expandedUrlByShort);
    }
    return output;
  }

  function extractText(article, statusId, summaryOverride) {
    const textRoot = getFirstScopedNode(article, TWEET_TEXT_SELECTOR, article);
    const expandedUrlByShort = buildExpandedUrlMapForStatus(article, statusId, summaryOverride);
    const tweetText = textRoot
      ? normalizeWhitespace(renderTweetTextNode(textRoot, expandedUrlByShort))
      : null;
    const articleText = extractArticleReadText(article);

    if (tweetText && articleText) {
      if (articleText.includes(tweetText)) {
        return articleText;
      }
      if (tweetText.includes(articleText)) {
        return tweetText;
      }
      return `${tweetText}\n\n${articleText}`;
    }

    if (tweetText) {
      return tweetText;
    }
    if (articleText) {
      return articleText;
    }
    return null;
  }

  function extractArticleReadText(article) {
    const readView = getFirstScopedNode(article, ARTICLE_READ_VIEW_SELECTOR, article);
    if (!readView) {
      return null;
    }

    const titleEl = readView.querySelector(ARTICLE_TITLE_SELECTOR);
    const titleText = titleEl ? normalizeWhitespace(nodeText(titleEl)) : null;

    const lines = [];
    const seen = new Set();
    const spans = Array.from(readView.querySelectorAll('[data-block="true"] [data-text="true"]'));

    for (const span of spans) {
      const ownerArticle = span.closest('article[data-testid="tweet"]');
      if (ownerArticle && ownerArticle !== article) {
        continue;
      }
      const text = normalizeWhitespace(nodeText(span));
      if (!text) {
        continue;
      }
      if (seen.has(text)) {
        continue;
      }
      seen.add(text);
      lines.push(text);
    }

    if (titleText && lines.length > 0 && lines[0] === titleText) {
      lines.shift();
    }

    const bodyText = lines.join("\n").trim();
    if (titleText && bodyText) {
      return `${titleText}\n\n${bodyText}`;
    }
    if (titleText) {
      return titleText;
    }
    if (bodyText) {
      return bodyText;
    }
    return null;
  }

  function parseJapaneseCount(label) {
    if (!label) {
      return null;
    }
    const match = label.match(/([0-9][0-9,]*)\s*件/);
    if (!match) {
      return null;
    }
    const value = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  }

  function extractMetrics(article) {
    const metrics = {};
    const keyToSelector = {
      replies: '[data-testid="reply"]',
      reposts: '[data-testid="retweet"]',
      likes: '[data-testid="like"]',
      bookmarks: '[data-testid="bookmark"]',
    };

    for (const [key, selector] of Object.entries(keyToSelector)) {
      const button = getFirstScopedNode(article, selector, article);
      const label = button ? button.getAttribute("aria-label") : null;
      metrics[key] = {
        raw: label,
        count: parseJapaneseCount(label),
      };
    }

    const viewsLink = getFirstScopedNode(article, ANALYTICS_LINK_SELECTOR, article);
    const viewsLabel = viewsLink ? viewsLink.getAttribute("aria-label") : null;
    metrics.views = {
      raw: viewsLabel,
      count: parseJapaneseCount(viewsLabel),
    };

    return metrics;
  }

  function extractMedia(article) {
    const photoLinks = uniq(
      getScopedLinks(article, PHOTO_LINK_SELECTOR, article).map((link) =>
        toAbsoluteUrl(link.getAttribute("href") || "")
      )
    );
    const imageUrls = uniq(
      getScopedNodes(article, '[data-testid="tweetPhoto"] img[src]', article).map((img) =>
        img.getAttribute("src") || ""
      )
    );

    return {
      photo_links: photoLinks,
      image_urls: imageUrls,
    };
  }

  function extractTweetCandidate(article) {
    const primaryRef = findPrimaryStatusRef(article);
    if (!primaryRef || !primaryRef.status_id) {
      return null;
    }

    const statusId = primaryRef.status_id;

    const summary = getPayloadSummaryForStatus(article, statusId);
    const text = extractText(article, statusId, summary);
    const socialContext = extractSocialContext(article);
    const mentionHandles = uniq([
      ...extractMentionHandles(text),
      ...extractMentionHandles(socialContext),
    ]);
    const quotedItems = extractQuotedItems(article, statusId);
    const replyTo = extractReplyToInfo(article, statusId, socialContext);
    const links = extractTweetLinks(article, statusId, summary);

    return {
      article,
      status_id: statusId,
      status_url: primaryRef.status_url || null,
      posted_at: (() => {
        const exactSelector = `a[href*="/status/${statusId}"] time[datetime], a[href*="/article/${statusId}"] time[datetime]`;
        const exactTime = getFirstScopedNode(article, exactSelector, article);
        if (exactTime) {
          return exactTime.getAttribute("datetime");
        }
        const fallbackTime = getFirstScopedNode(article, "time[datetime]", article);
        return fallbackTime ? fallbackTime.getAttribute("datetime") : null;
      })(),
      author: extractUserInfo(article),
      text,
      text_length: text ? text.length : 0,
      links,
      media: extractMedia(article),
      metrics: extractMetrics(article),
      mention_handles: mentionHandles,
      status_refs: collectStatusRefs(article),
      quoted_items: quotedItems,
      reply_to: replyTo,
      context_hints: {
        section_heading: findSectionHeading(article),
        timeline_label: findTimelineLabel(article),
        social_context: socialContext,
      },
    };
  }

  function emptyMetrics() {
    return {
      replies: { raw: null, count: null },
      reposts: { raw: null, count: null },
      likes: { raw: null, count: null },
      bookmarks: { raw: null, count: null },
      views: { raw: null, count: null },
    };
  }

  function metricsFromSummary(summary) {
    if (!summary) {
      return emptyMetrics();
    }
    return {
      replies: { raw: null, count: summary.reply_count == null ? null : summary.reply_count },
      reposts: { raw: null, count: summary.repost_count == null ? null : summary.repost_count },
      likes: { raw: null, count: summary.like_count == null ? null : summary.like_count },
      bookmarks: { raw: null, count: summary.bookmark_count == null ? null : summary.bookmark_count },
      views: { raw: null, count: summary.views_count == null ? null : summary.views_count },
    };
  }

  function mergeMetrics(domMetrics, payloadMetrics) {
    const baseDom = domMetrics || emptyMetrics();
    const basePayload = payloadMetrics || emptyMetrics();
    const keys = ["replies", "reposts", "likes", "bookmarks", "views"];
    const merged = {};

    for (const key of keys) {
      const dom = baseDom[key] || { raw: null, count: null };
      const payload = basePayload[key] || { raw: null, count: null };
      merged[key] = {
        raw: dom.raw != null ? dom.raw : payload.raw,
        count: dom.count != null ? dom.count : payload.count,
      };
    }
    return merged;
  }

  function resolveReplyToFromSummary(summary, statusInfoById) {
    if (!summary) {
      return null;
    }

    const replyStatusId = normalizeStatusId(summary.in_reply_to_status_id);
    const replyHandle = normalizeHandle(summary.in_reply_to_screen_name);
    if (!replyStatusId && !replyHandle) {
      return null;
    }

    const replyInfo = replyStatusId && statusInfoById ? statusInfoById.get(replyStatusId) || null : null;
    const finalHandle = replyHandle || (replyInfo && replyInfo.handle) || null;
    const statusUrl = replyStatusId
      ? (replyInfo && replyInfo.status_url) || buildHandleStatusUrl(finalHandle, replyStatusId)
      : null;

    return {
      status_id: replyStatusId || null,
      status_url: statusUrl || null,
      handle: finalHandle,
      handle_text: finalHandle ? `@${finalHandle}` : null,
      source: "react_payload",
    };
  }

  function resolveCanonicalPostedAt(article, canonicalId) {
    if (!article) {
      return null;
    }
    const safeCanonicalId = normalizeStatusId(canonicalId);
    if (!safeCanonicalId) {
      const fallbackTime = article.querySelector("time[datetime]");
      return fallbackTime ? fallbackTime.getAttribute("datetime") : null;
    }

    const selector = `a[href*="/status/${safeCanonicalId}"] time[datetime], a[href*="/article/${safeCanonicalId}"] time[datetime]`;
    const exactTime = article.querySelector(selector);
    if (exactTime) {
      return exactTime.getAttribute("datetime");
    }

    const fallbackTime = article.querySelector("time[datetime]");
    return fallbackTime ? fallbackTime.getAttribute("datetime") : null;
  }

  function extractPrimaryCandidateFromDocument(canonicalId) {
    const safeCanonicalId = normalizeStatusId(canonicalId);
    if (!safeCanonicalId) {
      return null;
    }

    const canonicalHref = (document.querySelector('link[rel="canonical"]') || {}).href || null;
    const canonicalMatch = findCanonicalArticleMatch(safeCanonicalId, document);
    const ownerArticle = canonicalMatch ? canonicalMatch.article : null;
    const ownerPrimaryRef = ownerArticle ? findPrimaryStatusRef(ownerArticle) : null;
    const ownerMatchesCanonical = Boolean(
      ownerArticle &&
        ownerPrimaryRef &&
        ownerPrimaryRef.status_id === safeCanonicalId
    );
    const canUseOwnerArticle = Boolean(
      ownerArticle && (ownerMatchesCanonical || (canonicalMatch && canonicalMatch.has_time))
    );

    let payloadIndex = collectPayloadSummaryAndStatusIndex(ownerArticle || document);
    if (
      ownerArticle &&
      (!payloadIndex || !payloadIndex.best_by_status || !payloadIndex.best_by_status.has(safeCanonicalId))
    ) {
      payloadIndex = collectPayloadSummaryAndStatusIndex(document);
    }

    const bestByStatus = (payloadIndex && payloadIndex.best_by_status) || new Map();
    const statusInfoById = (payloadIndex && payloadIndex.status_info_by_id) || new Map();
    const summary = bestByStatus.get(safeCanonicalId) || null;
    const statusInfo = statusInfoById.get(safeCanonicalId) || null;

    let text = null;
    if (canUseOwnerArticle) {
      text = extractText(ownerArticle, safeCanonicalId, summary);
    }
    if (!text && summary && summary.text) {
      text = summary.text;
    }
    if (!text) {
      const readViews = Array.from(document.querySelectorAll(ARTICLE_READ_VIEW_SELECTOR));
      if (readViews.length === 1) {
        const readRoot = readViews[0].closest(TWEET_SELECTOR) || readViews[0];
        text = extractArticleReadText(readRoot);
      }
    }
    if (!text) {
      return null;
    }

    const domAuthor = canUseOwnerArticle ? extractUserInfo(ownerArticle) : null;
    const authorHandle = normalizeHandle(
      firstString([
        summary && summary.author_handle,
        statusInfo && statusInfo.handle,
        domAuthor && domAuthor.handle,
      ])
    );
    const authorDisplayName =
      firstString([
        summary && summary.author_name,
        domAuthor && domAuthor.display_name,
      ]) || null;
    const author = {
      handle: authorHandle,
      handle_text: authorHandle ? `@${authorHandle}` : null,
      display_name: authorDisplayName,
    };

    const statusUrl =
      (statusInfo && statusInfo.status_url) ||
      (summary && summary.status_url) ||
      (canonicalMatch && canonicalMatch.status_url) ||
      buildHandleStatusUrl(authorHandle, safeCanonicalId) ||
      statusUrlFromCanonicalHref(canonicalHref, safeCanonicalId);

    const postedAt =
      (canUseOwnerArticle && resolveCanonicalPostedAt(ownerArticle, safeCanonicalId)) ||
      (summary && summary.created_at) ||
      null;

    const domMetrics = canUseOwnerArticle ? extractMetrics(ownerArticle) : emptyMetrics();
    const payloadMetrics = metricsFromSummary(summary);
    const metrics = mergeMetrics(domMetrics, payloadMetrics);
    const media = canUseOwnerArticle ? extractMedia(ownerArticle) : { photo_links: [], image_urls: [] };
    const replyTo = resolveReplyToFromSummary(summary, statusInfoById);
    const quotedItems = extractQuotedItemsFromReactPayload(ownerArticle || document, safeCanonicalId);
    const links = canUseOwnerArticle
      ? extractTweetLinks(ownerArticle, safeCanonicalId, summary)
      : collectTweetLinksFromSummary(summary);

    return {
      article: ownerArticle || document,
      status_id: safeCanonicalId,
      status_url: statusUrl || null,
      posted_at: postedAt,
      author,
      text,
      text_length: text.length,
      links,
      media,
      metrics,
      mention_handles: extractMentionHandles(text),
      status_refs: [safeCanonicalId],
      quoted_items: quotedItems,
      reply_to: replyTo,
      context_hints: {
        section_heading: null,
        timeline_label: null,
        social_context: null,
      },
      synthetic_primary: true,
    };
  }

  function buildPayloadContextCandidates(primaryCandidate, existingStatusIds) {
    if (!primaryCandidate || !primaryCandidate.status_id) {
      return [];
    }

    const payloadIndex = collectPayloadSummaryAndStatusIndex(document);
    if (!payloadIndex) {
      return [];
    }

    const bestByStatus = payloadIndex.best_by_status || new Map();
    const statusInfoById = payloadIndex.status_info_by_id || new Map();
    const primaryStatusId = primaryCandidate.status_id;
    const primaryAuthor = primaryCandidate.author || {
      handle: null,
      handle_text: null,
      display_name: null,
    };
    const primaryStatusUrl =
      primaryCandidate.status_url ||
      buildHandleStatusUrl(primaryAuthor.handle, primaryStatusId) ||
      `https://x.com/i/web/status/${primaryStatusId}`;

    const out = [];
    for (const [statusId, summary] of bestByStatus.entries()) {
      if (!statusId || statusId === primaryStatusId) {
        continue;
      }
      if (existingStatusIds && existingStatusIds.has(statusId)) {
        continue;
      }

      const replyToPrimary =
        normalizeStatusId(summary && summary.in_reply_to_status_id) === primaryStatusId;
      const quotePrimary =
        normalizeStatusId(summary && summary.quoted_status_id) === primaryStatusId;
      if (!replyToPrimary && !quotePrimary) {
        continue;
      }

      const statusInfo = statusInfoById.get(statusId) || null;
      const handle = normalizeHandle(
        firstString([
          summary && summary.author_handle,
          statusInfo && statusInfo.handle,
        ])
      );
      const statusUrl =
        (statusInfo && statusInfo.status_url) ||
        (summary && summary.status_url) ||
        buildHandleStatusUrl(handle, statusId) ||
        `https://x.com/i/web/status/${statusId}`;
      const text = (summary && summary.text) || null;
      const quotedItems = [];
      if (quotePrimary) {
        quotedItems.push({
          type: "tweet",
          status_id: primaryStatusId,
          status_url: primaryStatusUrl,
          author: {
            handle: primaryAuthor.handle || null,
            handle_text: primaryAuthor.handle ? `@${primaryAuthor.handle}` : null,
            display_name: primaryAuthor.display_name || null,
          },
          text: null,
          article: null,
        });
      }

      out.push({
        article: null,
        status_id: statusId,
        status_url: statusUrl,
        posted_at: (summary && summary.created_at) || null,
        author: {
          handle: handle || null,
          handle_text: handle ? `@${handle}` : null,
          display_name: (summary && summary.author_name) || null,
        },
        text,
        text_length: text ? text.length : 0,
        links: collectTweetLinksFromSummary(summary),
        media: {
          photo_links: [],
          image_urls: [],
        },
        metrics: metricsFromSummary(summary),
        mention_handles: extractMentionHandles(text),
        status_refs: uniq([
          statusId,
          primaryStatusId,
        ]),
        quoted_items: quotedItems,
        reply_to: resolveReplyToFromSummary(summary, statusInfoById),
        context_hints: {
          section_heading: null,
          timeline_label: null,
          social_context: null,
        },
        synthetic_context: true,
      });
    }

    out.sort((a, b) => {
      const at = a.posted_at ? Date.parse(a.posted_at) : Number.NaN;
      const bt = b.posted_at ? Date.parse(b.posted_at) : Number.NaN;
      if (Number.isFinite(at) && Number.isFinite(bt)) {
        return at - bt;
      }
      if (Number.isFinite(at)) {
        return -1;
      }
      if (Number.isFinite(bt)) {
        return 1;
      }
      return String(a.status_id).localeCompare(String(b.status_id));
    });

    return out;
  }

  function isLowQualityPrimaryCandidate(candidate, expectedStatusId) {
    if (!candidate || !candidate.status_id) {
      return true;
    }
    if (expectedStatusId && candidate.status_id !== expectedStatusId) {
      return true;
    }

    const text = normalizeWhitespace(candidate.text || "");
    const textLooksUrlOnly = /^https?:\/\/t\.co\/[A-Za-z0-9]+$/i.test(text);
    const hasDisplayName = Boolean(candidate.author && candidate.author.display_name);
    const metrics = candidate.metrics || emptyMetrics();
    const hasRawMetric = ["replies", "reposts", "likes", "bookmarks", "views"].some(
      (key) => Boolean(metrics[key] && metrics[key].raw)
    );

    if (candidate.synthetic_primary && textLooksUrlOnly) {
      return true;
    }
    if (candidate.synthetic_primary && !hasDisplayName) {
      return true;
    }
    if (candidate.synthetic_primary && !hasRawMetric) {
      return true;
    }
    return false;
  }

  async function probePrimaryCandidateFromTop(expectedStatusId) {
    const safeExpectedStatusId = normalizeStatusId(expectedStatusId);
    const previousY = window.scrollY || 0;
    try {
      if (previousY > 0) {
        window.scrollTo(0, 0);
        await sleep(320);
      }

      const topArticles = Array.from(document.querySelectorAll(TWEET_SELECTOR));
      if (topArticles.length === 0) {
        return null;
      }
      const topTarget = pickTargetTweet(topArticles);
      if (!topTarget || topTarget.error) {
        return safeExpectedStatusId
          ? extractPrimaryCandidateFromDocument(safeExpectedStatusId)
          : null;
      }

      const topCandidates = collectTweetCandidates(topArticles);
      const targetCandidate = topCandidates.find((item) => item.status_id === topTarget.statusId);
      if (targetCandidate) {
        return targetCandidate;
      }

      const extractedTarget =
        topTarget.article && topTarget.statusId
          ? extractTweetCandidate(topTarget.article)
          : null;
      if (
        extractedTarget &&
        extractedTarget.status_id &&
        (!safeExpectedStatusId || extractedTarget.status_id === safeExpectedStatusId)
      ) {
        return extractedTarget;
      }

      return safeExpectedStatusId
        ? extractPrimaryCandidateFromDocument(safeExpectedStatusId)
        : null;
    } finally {
      if (previousY > 0) {
        window.scrollTo(0, previousY);
      }
    }
  }

  async function probeContextByScrollingDownFromTop(expectedStatusId) {
    const startY = window.scrollY || 0;
    if (startY > 24) {
      return {
        used: false,
        before_count: document.querySelectorAll(TWEET_SELECTOR).length,
        after_count: document.querySelectorAll(TWEET_SELECTOR).length,
        before_reply_count: 0,
        after_reply_count: 0,
      };
    }

    const safeExpectedStatusId = normalizeStatusId(expectedStatusId);
    const beforeCount = document.querySelectorAll(TWEET_SELECTOR).length;
    const beforeCandidates = collectTweetCandidates(
      Array.from(document.querySelectorAll(TWEET_SELECTOR))
    );
    const beforeReplyCount = safeExpectedStatusId
      ? beforeCandidates.filter(
          (item) =>
            item.status_id !== safeExpectedStatusId &&
            item.reply_to &&
            item.reply_to.status_id === safeExpectedStatusId
        ).length
      : Math.max(0, beforeCandidates.length - 1);

    const maxSteps = 64;
    const stepPixels = Math.max(Math.floor(window.innerHeight * 1.25), 1000);
    let bestCount = beforeCount;
    let bestReplyCount = beforeReplyCount;
    let staleSteps = 0;

    for (let i = 0; i < maxSteps; i += 1) {
      window.scrollBy(0, stepPixels);
      await sleep(260);
      const count = document.querySelectorAll(TWEET_SELECTOR).length;
      const candidates = collectTweetCandidates(
        Array.from(document.querySelectorAll(TWEET_SELECTOR))
      );
      const replyCount = safeExpectedStatusId
        ? candidates.filter(
            (item) =>
              item.status_id !== safeExpectedStatusId &&
              item.reply_to &&
              item.reply_to.status_id === safeExpectedStatusId
          ).length
        : Math.max(0, candidates.length - 1);

      const progressed = count > bestCount || replyCount > bestReplyCount;
      if (count > bestCount) {
        bestCount = count;
      }
      if (replyCount > bestReplyCount) {
        bestReplyCount = replyCount;
      }
      if (progressed) {
        staleSteps = 0;
      } else {
        staleSteps += 1;
      }

      if (safeExpectedStatusId && bestReplyCount >= 10) {
        break;
      }
      if (!safeExpectedStatusId && bestCount >= 28) {
        break;
      }
      if (staleSteps >= 8 && i >= 12) {
        break;
      }
    }

    return {
      used: (window.scrollY || 0) > startY,
      before_count: beforeCount,
      after_count: bestCount,
      before_reply_count: beforeReplyCount,
      after_reply_count: bestReplyCount,
    };
  }

  function collectTweetCandidates(articles) {
    const seen = new Set();
    const out = [];
    for (const article of articles) {
      const candidate = extractTweetCandidate(article);
      if (!candidate || !candidate.status_id) {
        continue;
      }
      if (seen.has(candidate.status_id)) {
        continue;
      }
      seen.add(candidate.status_id);
      out.push(candidate);
    }
    return out;
  }

  function classifyRelation(candidate, primary) {
    const sectionHint = candidate.context_hints.section_heading || "";
    const timelineHint = candidate.context_hints.timeline_label || "";
    const socialContext = candidate.context_hints.social_context || "";
    const sectionText = sectionHint.toLowerCase();
    const timelineText = timelineHint.toLowerCase();
    const areaText = `${sectionText}\n${timelineText}`;
    const conversationPattern = /会話|conversation|スレッド|thread/i;
    const recommendedPattern = /もっと見つける|more to explore|xから|from x|関連|related|おすすめ|for you|discover/i;
    const sectionConversation = conversationPattern.test(sectionText);
    const timelineConversation = conversationPattern.test(timelineText);
    const sectionRecommended = recommendedPattern.test(sectionText);
    const timelineRecommended = recommendedPattern.test(timelineText);
    const mentionsPrimaryHandle = Boolean(
      primary.author.handle &&
        candidate.mention_handles.includes(primary.author.handle.toLowerCase())
    );
    const socialReply = /返信先|replying to/i.test(socialContext);
    const replyToStatusMatch = Boolean(
      candidate.reply_to &&
        candidate.reply_to.status_id &&
        candidate.reply_to.status_id === primary.status_id
    );
    const replyToHandleMatch = Boolean(
      candidate.reply_to &&
        candidate.reply_to.handle &&
        primary.author.handle &&
        candidate.reply_to.handle.toLowerCase() === primary.author.handle.toLowerCase()
    );
    const sameAuthor = Boolean(
      primary.author.handle &&
        candidate.author.handle &&
        primary.author.handle.toLowerCase() === candidate.author.handle.toLowerCase()
    );
    const referencesPrimary = candidate.status_refs.some(
      (statusId) => statusId === primary.status_id && statusId !== candidate.status_id
    );
    const conversationArea = conversationPattern.test(areaText);
    const recommendedArea = recommendedPattern.test(areaText);

    let placement = "unknown";
    let placementConfidence = 0.25;
    if (sectionRecommended || (!sectionConversation && timelineRecommended)) {
      placement = "recommended";
      placementConfidence = sectionRecommended ? 0.9 : 0.7;
    } else if (sectionConversation || timelineConversation) {
      placement = "conversation";
      placementConfidence = sectionConversation ? 0.85 : 0.65;
    } else if (timelineRecommended) {
      placement = "recommended";
      placementConfidence = 0.6;
    }

    let type = "unknown";
    let confidence = 0.2;

    if (replyToStatusMatch) {
      type = "reply_to_primary";
      confidence = 0.98;
    } else if (replyToHandleMatch && socialReply) {
      type = "reply_to_primary";
      confidence = 0.9;
    } else if (mentionsPrimaryHandle && socialReply) {
      type = "reply_to_primary";
      confidence = 0.95;
    } else if (socialReply) {
      type = "reply";
      confidence = 0.8;
    } else if (sameAuthor && placement === "conversation") {
      type = "same_author_thread";
      confidence = 0.84;
    } else if (sameAuthor) {
      type = "same_author";
      confidence = 0.68;
    } else if (referencesPrimary) {
      type = "references_primary";
      confidence = 0.76;
    } else if (placement === "recommended") {
      type = "recommended";
      confidence = 0.72;
    } else if (placement === "conversation") {
      type = "conversation_context";
      confidence = 0.6;
    } else if (recommendedArea) {
      type = "recommended";
      confidence = 0.5;
    }

    const reasons = [];
    if (socialReply) {
      reasons.push("social_context_reply");
    }
    if (mentionsPrimaryHandle) {
      reasons.push("mentions_primary_author");
    }
    if (replyToStatusMatch) {
      reasons.push("reply_to_primary_status");
    } else if (replyToHandleMatch) {
      reasons.push("reply_to_primary_handle");
    }
    if (sameAuthor) {
      reasons.push("same_author");
    }
    if (referencesPrimary) {
      reasons.push("references_primary_status");
    }
    if (conversationArea) {
      reasons.push("conversation_area");
    }
    if (recommendedArea) {
      reasons.push("recommended_area");
    }

    return {
      type,
      confidence,
      related_to_status_id: primary.status_id,
      reasons,
      placement: {
        type: placement,
        confidence: placementConfidence,
      },
      section_heading: sectionHint || null,
      timeline_label: timelineHint || null,
      social_context: socialContext || null,
    };
  }

  function buildRelationStats(items) {
    const byType = {};
    const byPlacement = {};
    for (const item of items) {
      const relationType = item.relation.type || "unknown";
      const placementType =
        (item.relation.placement && item.relation.placement.type) || "unknown";
      byType[relationType] = (byType[relationType] || 0) + 1;
      byPlacement[placementType] = (byPlacement[placementType] || 0) + 1;
    }
    return {
      total: items.length,
      by_type: byType,
      by_placement: byPlacement,
    };
  }

  function itemReferencesPrimaryStatus(item, primaryStatusId) {
    if (!item || !primaryStatusId) {
      return false;
    }
    if (
      Array.isArray(item.status_refs) &&
      item.status_refs.some((statusId) => statusId === primaryStatusId && statusId !== item.status_id)
    ) {
      return true;
    }

    const quotedItems = Array.isArray(item.quoted_items) ? item.quoted_items : [];
    for (const quoted of quotedItems) {
      if (!quoted) {
        continue;
      }
      if (quoted.status_id && quoted.status_id === primaryStatusId) {
        return true;
      }
      const articleStatusId =
        quoted.article && quoted.article.status_id ? quoted.article.status_id : null;
      if (articleStatusId && articleStatusId === primaryStatusId) {
        return true;
      }
      const refUrl =
        quoted.status_url ||
        (quoted.article && quoted.article.url ? quoted.article.url : null) ||
        null;
      const refStatusId = parseStatusId(refUrl || "") || parseArticleId(refUrl || "");
      if (refStatusId && refStatusId === primaryStatusId) {
        return true;
      }
    }

    return false;
  }

  function collectQuotedStatusIds(item) {
    const out = new Set();
    if (!item || !Array.isArray(item.quoted_items)) {
      return out;
    }
    for (const quoted of item.quoted_items) {
      if (!quoted) {
        continue;
      }
      const statusId =
        normalizeStatusId(quoted.status_id) ||
        parseStatusId(quoted.status_url || "") ||
        parseArticleId(quoted.status_url || "") ||
        normalizeStatusId(quoted.article && quoted.article.status_id) ||
        parseStatusId((quoted.article && quoted.article.url) || "") ||
        parseArticleId((quoted.article && quoted.article.url) || "");
      if (statusId) {
        out.add(statusId);
      }
    }
    return out;
  }

  function shouldKeepContextCandidate(item, primary, relation, primaryQuotedStatusIds) {
    if (!item || !item.status_id || !primary || !primary.status_id) {
      return false;
    }
    if (item.status_id === primary.status_id) {
      return false;
    }

    if (relation && relation.type === "recommended") {
      return false;
    }
    if (primaryQuotedStatusIds && primaryQuotedStatusIds.has(item.status_id)) {
      return false;
    }

    const primaryHandle = normalizeHandle(primary.author && primary.author.handle);
    const itemHandle = normalizeHandle(item.author && item.author.handle);
    const sameAuthor =
      Boolean(primaryHandle && itemHandle && primaryHandle.toLowerCase() === itemHandle.toLowerCase());
    const hasReplyTarget = Boolean(item.reply_to && (item.reply_to.status_id || item.reply_to.handle));
    const referencesPrimary = itemReferencesPrimaryStatus(item, primary.status_id);
    const mentionsPrimary = Boolean(
      primaryHandle &&
        Array.isArray(item.mention_handles) &&
        item.mention_handles.some(
          (handle) =>
            normalizeHandle(handle) &&
            normalizeHandle(handle).toLowerCase() === primaryHandle.toLowerCase()
        )
    );

    if (sameAuthor && !hasReplyTarget && !referencesPrimary) {
      return false;
    }
    if (relation && relation.type === "conversation_context") {
      const hasExplicitPrimaryLink = hasReplyTarget || referencesPrimary || mentionsPrimary || sameAuthor;
      if (!hasExplicitPrimaryLink) {
        return false;
      }
    }

    return true;
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!ok) {
      throw new Error("Clipboard copy failed");
    }
  }

  function notify(message, level) {
    const kind = level === "error" ? "error" : "log";
    const line = `[x-clipper] ${message}`;

    if (kind === "error") {
      console.error(line);
    } else {
      console.log(line);
    }

    try {
      const banner = document.createElement("div");
      banner.textContent = line;
      banner.style.position = "fixed";
      banner.style.left = "12px";
      banner.style.right = "12px";
      banner.style.bottom = "12px";
      banner.style.padding = "10px 12px";
      banner.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
      banner.style.fontSize = "12px";
      banner.style.lineHeight = "1.4";
      banner.style.borderRadius = "8px";
      banner.style.zIndex = "2147483647";
      banner.style.whiteSpace = "pre-wrap";
      banner.style.color = "#fff";
      banner.style.backgroundColor = kind === "error" ? "rgba(180, 35, 35, 0.95)" : "rgba(20, 20, 20, 0.95)";
      banner.style.boxShadow = "0 6px 24px rgba(0,0,0,0.35)";
      document.body.appendChild(banner);
      window.setTimeout(() => {
        banner.remove();
      }, kind === "error" ? 12000 : 6000);
    } catch (_error) {
      // ignore
    }

    if (kind === "error") {
      try {
        window.alert(line);
      } catch (_error) {
        // ignore
      }
    }
  }

  async function emitCaptureHook(payload, output) {
    const hook = window.__X_CLIPPER_CAPTURE_HOOK__;
    if (typeof hook !== "function") {
      return {
        delivered: false,
        skip_clipboard: false,
      };
    }

    try {
      const result = await hook({
        payload,
        output,
        page_url: window.location.href,
        emitted_at: new Date().toISOString(),
      });

      return {
        delivered: true,
        skip_clipboard: Boolean(result && result.skip_clipboard),
        result: result || null,
      };
    } catch (error) {
      return {
        delivered: true,
        skip_clipboard: false,
        error: error && error.message ? error.message : String(error),
      };
    }
  }

  async function run() {
    if (!isSupportedCapturePage()) {
      notify(
        'This page is not a tweet detail URL. Open a URL like "https://x.com/<handle>/status/<id>" and run x-clipper again.',
        "error"
      );
      return;
    }

    let downProbe = {
      used: false,
      before_count: 0,
      after_count: 0,
      before_reply_count: 0,
      after_reply_count: 0,
    };
    if ((window.scrollY || 0) <= 24) {
      const canonicalForDownProbe = getCanonicalStatusId();
      downProbe = await probeContextByScrollingDownFromTop(canonicalForDownProbe);
    }

    let articles = Array.from(document.querySelectorAll(TWEET_SELECTOR));
    if (articles.length === 0) {
      notify("No tweet article was found on this page.", "error");
      return;
    }

    let target = pickTargetTweet(articles);
    let canonicalFallbackPrimary = null;
    if (target && target.error_code === "canonical_not_found") {
      const revealed = tryRevealMutedTweetBlocks();
      if (revealed > 0) {
        await sleep(250);
        articles = Array.from(document.querySelectorAll(TWEET_SELECTOR));
        target = pickTargetTweet(articles);
      }
      if (target && target.error_code === "canonical_not_found") {
        canonicalFallbackPrimary = extractPrimaryCandidateFromDocument(target.canonical_id);
      }
    }

    if (target && target.error) {
      if (target.error_code === "canonical_not_found") {
        if (!canonicalFallbackPrimary) {
          const canonicalId = normalizeStatusId(target.canonical_id);
          const canonicalStatusRefs = canonicalId
            ? document.querySelectorAll(`a[href*="/status/${canonicalId}"]`).length
            : 0;
          const canonicalArticleRefs = canonicalId
            ? document.querySelectorAll(`a[href*="/article/${canonicalId}"]`).length
            : 0;
          const articleReadViews = document.querySelectorAll(ARTICLE_READ_VIEW_SELECTOR).length;
          notify(
            `${target.error}\nDiagnostics: page=${window.location.pathname}, canonical_status_refs=${canonicalStatusRefs}, canonical_article_refs=${canonicalArticleRefs}, article_read_views=${articleReadViews}\nHint: If the page says "このポストにはミュートしたキーワードが含まれています", reveal that post and run x-clipper again.`,
            "error"
          );
          return;
        }
      } else {
        notify(target.error, "error");
        return;
      }
    }
    if (!target && !canonicalFallbackPrimary) {
      notify("Could not determine the target tweet.", "error");
      return;
    }

    const canonicalEl = document.querySelector('link[rel="canonical"]');
    const tweetCandidates = collectTweetCandidates(articles);
    const targetArticleCandidate =
      target && target.article ? extractTweetCandidate(target.article) : null;
    const matchedTargetArticleCandidate =
      targetArticleCandidate &&
      target &&
      target.statusId &&
      targetArticleCandidate.status_id === target.statusId
        ? targetArticleCandidate
        : null;
    const canonicalSyntheticPrimary =
      !canonicalFallbackPrimary && target && target.statusId
        ? extractPrimaryCandidateFromDocument(target.statusId)
        : null;
    let primaryCandidate =
      canonicalFallbackPrimary ||
      tweetCandidates.find((item) => item.status_id === target.statusId) ||
      matchedTargetArticleCandidate ||
      canonicalSyntheticPrimary;
    const expectedPrimaryStatusId =
      normalizeStatusId(target && target.statusId) ||
      normalizeStatusId(primaryCandidate && primaryCandidate.status_id);
    let usedTopProbe = false;
    if (isLowQualityPrimaryCandidate(primaryCandidate, expectedPrimaryStatusId)) {
      usedTopProbe = true;
      const probedPrimary = await probePrimaryCandidateFromTop(expectedPrimaryStatusId);
      if (!isLowQualityPrimaryCandidate(probedPrimary, expectedPrimaryStatusId)) {
        primaryCandidate = probedPrimary;
      }
    }
    if (!primaryCandidate) {
      notify("Could not extract the primary tweet payload.", "error");
      return;
    }

    const contextCandidateMap = new Map();
    for (const item of tweetCandidates) {
      if (!item || !item.status_id || item.status_id === primaryCandidate.status_id) {
        continue;
      }
      contextCandidateMap.set(item.status_id, item);
    }

    const payloadContextCandidates = buildPayloadContextCandidates(
      primaryCandidate,
      new Set([primaryCandidate.status_id, ...tweetCandidates.map((item) => item.status_id)])
    );
    for (const item of payloadContextCandidates) {
      if (!item || !item.status_id) {
        continue;
      }
      if (!contextCandidateMap.has(item.status_id)) {
        contextCandidateMap.set(item.status_id, item);
      }
    }

    const contextCandidateList = Array.from(contextCandidateMap.values());
    const contextTweets = [];
    const primaryQuotedStatusIds = collectQuotedStatusIds(primaryCandidate);
    for (const item of contextCandidateList) {
      const relation = classifyRelation(item, primaryCandidate);
      if (!shouldKeepContextCandidate(item, primaryCandidate, relation, primaryQuotedStatusIds)) {
        continue;
      }
      contextTweets.push({
        status_id: item.status_id,
        status_url: item.status_url,
        posted_at: item.posted_at,
        author: item.author,
        text: item.text,
        text_length: item.text_length,
        links: item.links || [],
        media: item.media,
        metrics: item.metrics,
        quoted_items: item.quoted_items,
        reply_to: item.reply_to,
        relation,
      });
    }

    const relatedSelfPosts = contextTweets
      .filter(
        (item) =>
          primaryCandidate.author.handle &&
          item.author.handle &&
          item.author.handle.toLowerCase() === primaryCandidate.author.handle.toLowerCase()
      )
      .map((item) => ({
        status_id: item.status_id,
        status_url: item.status_url,
      }));

    const payload = {
      schema_version: 1,
      source: "x.com",
      captured_at: new Date().toISOString(),
      page_url: window.location.href,
      canonical_url: canonicalEl ? canonicalEl.href : null,
      capture_scope: {
        tweet_articles_found: articles.length,
        distinct_tweets_found: 1 + contextTweets.length,
      },
      tweet: {
        status_id: primaryCandidate.status_id,
        status_url: primaryCandidate.status_url,
        posted_at: primaryCandidate.posted_at,
        author: primaryCandidate.author,
        text: primaryCandidate.text,
        text_length: primaryCandidate.text_length,
        links: primaryCandidate.links || [],
        media: primaryCandidate.media,
        metrics: primaryCandidate.metrics,
        quoted_items: primaryCandidate.quoted_items,
        reply_to: primaryCandidate.reply_to,
      },
      context_tweets: contextTweets,
      context_relation_stats: buildRelationStats(contextTweets),
      related_self_posts: relatedSelfPosts,
    };

    const output = JSON.stringify(payload, null, 2);
    const relay = await emitCaptureHook(payload, output);

    if (relay.delivered && relay.result && relay.result.cancelled) {
      notify("Capture cancelled before ingest.");
      return;
    }

    if (relay.delivered && relay.error) {
      notify(`Extension relay failed: ${relay.error}. Falling back to clipboard copy.`, "error");
    }
    if (relay.delivered && relay.skip_clipboard) {
      const selectedTags =
        relay.result && Array.isArray(relay.result.tags) ? relay.result.tags : [];
      const tagSuffix = selectedTags.length > 0 ? `, tags=${selectedTags.join(",")}` : "";
      const probeSuffix = downProbe.used
        ? `, auto_scroll=${downProbe.before_count}->${downProbe.after_count}, auto_replies=${downProbe.before_reply_count}->${downProbe.after_reply_count}`
        : "";
      notify(
        `Captured via extension relay. status_id=${payload.tweet.status_id}, context_tweets=${payload.context_tweets.length}${tagSuffix}${probeSuffix}`
      );
      return;
    }

    if (usedTopProbe || downProbe.used) {
      notify(
        "Capture required async probe; opening manual copy prompt instead of clipboard API."
      );
      try {
        window.prompt("Copy tweet JSON manually:", output);
      } catch (_error) {
        // ignore
      }
      return;
    }

    try {
      await copyToClipboard(output);
      console.log("[x-clipper] copied payload", payload);
      notify(
        `Copied tweet JSON to clipboard. status_id=${payload.tweet.status_id}, text_length=${payload.tweet.text_length}, context_tweets=${payload.context_tweets.length}`
      );
      return;
    } catch (error) {
      notify(
        `Clipboard copy failed: ${error && error.message ? error.message : String(error)}. Opening manual copy prompt.`,
        "error"
      );
      try {
        window.prompt("Copy tweet JSON manually:", output);
      } catch (_error) {
        // ignore
      }
    }
  }

  run().catch((error) => {
    console.error("[x-clipper] error", error);
    notify(`x-clipper failed: ${error && error.message ? error.message : String(error)}`, "error");
  });
})();
