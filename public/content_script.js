/* global chrome */

// ===================== 常量与状态 =====================
const SETTINGS_KEY = "video_keep_settings";
const DEFAULT_TEMPLATE = "{screenName}_{username}_{tweetTime}";
const DOWNLOAD_ICON = `
  <span style="display:inline-flex;align-items:center;justify-content:center;line-height:1">
    <svg viewBox="64 64 896 896" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M624 706.3h-74.1V464c0-4.4-3.6-8-8-8h-60c-4.4 0-8 3.6-8 8v242.3H400c-6.7 0-10.4 7.7-6.3 12.9l112 141.7a8 8 0 0012.6 0l112-141.7c4.1-5.2.4-12.9-6.3-12.9z"></path>
      <path d="M811.4 366.7C765.6 245.9 648.9 160 512.2 160S258.8 245.8 213 366.6C127.3 389.1 64 467.2 64 560c0 110.5 89.5 200 199.9 200H304c4.4 0 8-3.6 8-8v-60c0-4.4-3.6-8-8-8h-40.1c-33.7 0-65.4-13.4-89-37.7-23.5-24.2-36-56.8-34.9-90.6.9-26.4 9.9-51.2 26.2-72.1 16.7-21.3 40.1-36.8 66.1-43.7l37.9-9.9 13.9-36.6c8.6-22.8 20.6-44.1 35.7-63.4a245.6 245.6 0 0152.4-49.9c41.1-28.9 89.5-44.2 140-44.2s98.9 15.3 140 44.2c19.9 14 37.5 30.8 52.4 49.9 15.1 19.3 27.1 40.7 35.7 63.4l13.8 36.5 37.8 10C846.1 454.5 884 503.8 884 560c0 33.1-12.9 64.3-36.3 87.7a123.07 123.07 0 01-87.6 36.3H720c-4.4 0-8 3.6-8 8v60c0 4.4 3.6 8 8 8h40.1C870.5 760 960 670.5 960 560c0-92.7-63.1-170.7-148.6-193.3z"></path>
    </svg>
  </span>`;
const DOWNLOADED_ICON = `
  <span style="display:inline-flex;align-items:center;justify-content:center;line-height:1">
    <svg viewBox="64 64 896 896" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M704 446H320c-4.4 0-8 3.6-8 8v402c0 4.4 3.6 8 8 8h384c4.4 0 8-3.6 8-8V454c0-4.4-3.6-8-8-8zm-328 64h272v117H376V510zm272 290H376V683h272v117z"></path>
      <path d="M424 748a32 32 0 1064 0 32 32 0 10-64 0zm0-178a32 32 0 1064 0 32 32 0 10-64 0z"></path>
      <path d="M811.4 368.9C765.6 248 648.9 162 512.2 162S258.8 247.9 213 368.8C126.9 391.5 63.5 470.2 64 563.6 64.6 668 145.6 752.9 247.6 762c4.7.4 8.7-3.3 8.7-8v-60.4c0-4-3-7.4-7-7.9-27-3.4-52.5-15.2-72.1-34.5-24-23.5-37.2-55.1-37.2-88.6 0-28 9.1-54.4 26.2-76.4 16.7-21.4 40.2-36.9 66.1-43.7l37.9-10 13.9-36.7c8.6-22.8 20.6-44.2 35.7-63.5 14.9-19.2 32.6-36 52.4-50 41.1-28.9 89.5-44.2 140-44.2s98.9 15.3 140 44.3c19.9 14 37.5 30.8 52.4 50 15.1 19.3 27.1 40.7 35.7 63.5l13.8 36.6 37.8 10c54.2 14.4 92.1 63.7 92.1 120 0 33.6-13.2 65.1-37.2 88.6-19.5 19.2-44.9 31.1-71.9 34.5-4 .5-6.9 3.9-6.9 7.9V754c0 4.7 4.1 8.4 8.8 8 101.7-9.2 182.5-94 183.2-198.2.6-93.4-62.7-172.1-148.6-194.9z"></path>
    </svg>
  </span>`;
const VIDEO_PATTERN = /\.m3u8($|[?#])|video\.twimg\.com/;
const TEMPLATE_KEYS = [
  "screenName",
  "username",
  "tweetTime",
  "tweetId",
  "random",
  "text",
  "userId",
];

const mediaCache = new Map();
let filenameTemplate = DEFAULT_TEMPLATE;

// ===================== 设置读取 =====================
function hydrateTemplate() {
  const storage = chrome.storage?.local;
  if (storage) {
    storage.get([SETTINGS_KEY], (result) => {
      if (chrome.runtime?.lastError) return;
      const tpl = result?.[SETTINGS_KEY]?.filenameTemplate;
      if (tpl) filenameTemplate = tpl;
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      const tpl = changes?.[SETTINGS_KEY]?.newValue?.filenameTemplate;
      if (tpl) filenameTemplate = tpl;
    });
  } else {
    try {
      const cached = localStorage.getItem(SETTINGS_KEY);
      if (cached) {
        const tpl = JSON.parse(cached)?.filenameTemplate;
        if (tpl) filenameTemplate = tpl;
      }
    } catch (_) {}
  }
}

// ===================== Indexed JSON → 元数据 =====================
function parseTweetTimestamp(str) {
  const value = Date.parse(str || "");
  return Number.isNaN(value) ? undefined : value;
}

function normalizeImage(url) {
  if (!url) return undefined;
  return /:(?:large|orig)$/i.test(url) ? url : `${url}:orig`;
}

function mergeMetadata(tweetId, patch = {}) {
  if (!tweetId) return;
  const prev = mediaCache.get(tweetId) || {};
  const next = { ...prev, ...patch };

  if (patch.images && Array.isArray(patch.images)) {
    const merged = [...(prev.images || [])];
    patch.images.forEach((img) => {
      if (!img?.url) return;
      if (!merged.some((item) => item.url === img.url)) merged.push(img);
    });
    next.images = merged;
  }

  mediaCache.set(tweetId, next);
}

function collectImages(tweetId, media) {
  if (!tweetId || !Array.isArray(media)) return;
  const images = media
    .filter(
      (m) =>
        m?.media_url_https && (m.type === "photo" || m.type === "animated_gif"),
    )
    .map((m) => ({
      url: normalizeImage(m.media_url_https || m.media_url),
      type: m.type,
      id: m.id_str || m.id,
    }))
    .filter((x) => x.url);
  if (images.length) mergeMetadata(tweetId, { images });
}

function collectVariants(tweetId, variants = [], extra = {}) {
  if (Array.isArray(variants) && variants.length) {
    const mp4s = variants.filter((v) => /mp4/i.test(v?.content_type || ""));
    if (mp4s.length) mergeMetadata(tweetId, { ...extra, variants: mp4s });
  } else {
    mergeMetadata(tweetId, extra);
  }
}

function extractUser(node) {
  const result =
    node?.core?.user_results?.result ||
    node?.core?.user_result_by_id?.result ||
    node?.author?.result ||
    node?.user_result?.result ||
    node?.user;
  const legacy = result?.legacy || result;
  return {
    screenName: legacy?.screen_name || legacy?.username,
    username: legacy?.name,
    userId: legacy?.id_str || result?.rest_id,
  };
}

function parseTweetNode(node) {
  if (!node || typeof node !== "object") return;
  const legacy = node.legacy || node.tweet?.legacy || node;
  const tweetId =
    node.rest_id || node.tweet?.rest_id || legacy.id_str || legacy.id;
  if (!tweetId) return;

  const createdAt = parseTweetTimestamp(legacy.created_at);
  const text = legacy.full_text || legacy.text;
  const user = extractUser(node);

  mergeMetadata(tweetId, {
    tweetId,
    tweetCreatedAt: createdAt,
    text,
    screenName: user.screenName,
    username: user.username,
    userId: user.userId,
  });

  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  collectImages(tweetId, media);
  media.forEach((m) => collectVariants(tweetId, m?.video_info?.variants, {}));
}

function walkAny(obj) {
  if (!obj || typeof obj !== "object") return;
  parseTweetNode(obj);
  Object.values(obj).forEach((val) => {
    if (Array.isArray(val)) val.forEach(walkAny);
    else if (val && typeof val === "object") walkAny(val);
  });
}

// ===================== 页面 Hook =====================
function injectHooks() {
  if (document.getElementById("vk-x-hooks")) return;
  const url = chrome.runtime?.getURL?.("injected-hooks.js");
  if (!url) return;
  const script = document.createElement("script");
  script.id = "vk-x-hooks";
  script.src = url;
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);
}

document.addEventListener("mh:media-response", (ev) => {
  try {
    const { path, body } = ev.detail || {};
    if (!body) return;
    const data = JSON.parse(body);
    if (/\/graphql\//.test(path)) walkAny(data);
    else if (/\/videos?\/tweet\/config\//.test(path)) {
      const tweetId = data?.track?.id || data?.tweet_id || data?.tweetId;
      const playbackUrl = data?.track?.playbackUrl || data?.playbackUrl;
      const variants =
        data?.track?.variants ||
        data?.variants ||
        data?.track?.media?.variants ||
        [];
      if (tweetId) {
        mergeMetadata(tweetId, {
          tweetId,
          screenName: data?.track?.author?.screen_name,
          username: data?.track?.author?.name,
          playbackUrl,
          source: "tweet_config",
        });
        collectVariants(tweetId, variants, {});
        if (playbackUrl) {
          const mp4 = rewritePlaylist(playbackUrl);
          if (mp4)
            collectVariants(
              tweetId,
              [{ url: mp4, content_type: "video/mp4" }],
              {},
            );
        }
      }
    }
  } catch (_) {}
});

// ===================== 文件名与工具 =====================
function sanitize(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

function randomId(len = 6) {
  const chars = "ABCDEFGHJKMNPQRSTWXYZ2345678";
  return Array.from(
    { length: len },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function buildFilename(meta) {
  const now = meta.tweetCreatedAt || Date.now();
  const replacements = {
    screenName: sanitize(meta.screenName || meta.handle || "user"),
    username: sanitize(meta.username || meta.displayName || "user"),
    userId: sanitize(
      meta.username || meta.displayName || meta.screenName || "user",
    ),
    tweetTime: sanitize(formatTimestamp(now)),
    tweetId: sanitize(meta.tweetId || "tweet"),
    random: sanitize(randomId()),
    text: sanitize((meta.text || "").slice(0, 30)),
  };

  let result = filenameTemplate.replace(/\{(\w+)\}/g, (match, key) => {
    if (!TEMPLATE_KEYS.includes(key)) return match;
    return replacements[key] || "";
  });

  result = result.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!/\.\w{2,4}$/.test(result)) result = `${result || "video"}.mp4`;
  const folder = replacements.screenName || "user";
  const site = sanitize((location && location.host) || "site");
  return `${site}/${folder}/${result}`;
}

function rewritePlaylist(url) {
  try {
    const parsed = new URL(url, location.origin);
    if (!/\.m3u8($|[?#])/.test(parsed.pathname)) return undefined;
    const dir = parsed.href.replace(/playlist\.m3u8[^?#]*/, "");
    const sizes = [
      "1080x1920",
      "1920x1080",
      "1280x720",
      "720x1280",
      "720x720",
      "540x960",
      "480x852",
      "360x640",
      "320x568",
    ];
    for (const size of sizes) {
      const candidate = `${dir}${size}.mp4${parsed.search || ""}`;
      if (candidate) return candidate;
    }
    return parsed.href.replace(
      /playlist\.m3u8/,
      `${parsed.searchParams.get("name") || "video"}.mp4`,
    );
  } catch (_) {
    return undefined;
  }
}

function selectVideoUrl(tweetId) {
  const meta = mediaCache.get(tweetId) || {};
  const variants = meta.variants || [];
  const best = variants
    .filter((v) => /mp4/i.test(v?.content_type || ""))
    .sort((a, b) => (b?.bitrate || 0) - (a?.bitrate || 0))[0];
  if (best?.url) return best.url;
  if (meta.rewrittenUrl) return meta.rewrittenUrl;
  if (meta.playbackUrl) return rewritePlaylist(meta.playbackUrl);
  return undefined;
}

function pickHtmlVideo(article) {
  const urls = new Set();
  article.querySelectorAll("video, source").forEach((el) => {
    ["src", "currentSrc"].forEach((attr) => {
      const val = el[attr] || el.getAttribute?.(attr);
      if (val && /^https?:/.test(val) && !/^blob:/.test(val)) urls.add(val);
    });
  });
  return Array.from(urls).find((u) => VIDEO_PATTERN.test(u));
}

function parseNames(article) {
  const wrapper = article.querySelector('[data-testid="User-Name"]');
  let display;
  let handle;
  wrapper?.querySelectorAll("span").forEach((span) => {
    const text = span.textContent?.trim();
    if (!text) return;
    if (text.startsWith("@")) handle = handle || text.slice(1);
    else display = display || text;
  });
  return { display, handle };
}

function readArticleMeta(article, tweetId) {
  const stored = mediaCache.get(tweetId) || {};
  const names = parseNames(article);
  const username = stored.username || names.display || "user";
  const screenName = stored.screenName || names.handle || username;
  const text =
    stored.text ||
    article
      .querySelector('[data-testid="tweetText"], h1, h2, h3')
      ?.textContent?.trim()
      ?.slice(0, 30) ||
    "";
  return {
    ...stored,
    username,
    screenName,
    text,
    tweetId,
  };
}

// ===================== UI 注入与事件 =====================
function makeButton(title) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vk-tweet-download-btn";
  btn.innerHTML = DOWNLOAD_ICON;
  btn.title = title;
  Object.assign(btn.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px",
    marginLeft: "8px",
    borderRadius: "999px",
    border: "none",
    background: "transparent",
    color: "rgb(29,155,240)",
    cursor: "pointer",
  });
  return btn;
}

function markDownloaded(btn) {
  btn.disabled = true;
  btn.innerHTML = DOWNLOADED_ICON;
  btn.style.color = "#8b8b8b";
  btn.style.cursor = "not-allowed";
}

function currentTweetId(article) {
  const timeLink = article
    .querySelector('a[href*="/status/"] time')
    ?.closest('a[href*="/status/"]');
  const fallbackLink = article.querySelector(
    'a[role="link"][href*="/status/"]',
  );
  const anyLink = article.querySelector('a[href*="/status/"]');
  const attrLink = article.querySelector("[data-tweet-id]");
  const extract = (node) => {
    const href = node?.getAttribute?.("href") || "";
    const match = href.match(/\/_?status\/(\d+)/);
    return match ? match[1] : undefined;
  };
  return (
    extract(timeLink) ||
    extract(fallbackLink) ||
    extract(anyLink) ||
    attrLink?.getAttribute("data-tweet-id")
  );
}

function scheduleDownload(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "VK_DOWNLOAD", payload }, (res) => {
      if (res && !res.ok) console.warn("download failed", res.error);
      resolve(res);
    });
  });
}

function injectButton(article) {
  if (!article || article.dataset.vkBtnInjected === "1") return;
  const actionBar =
    article.querySelector('[role="group"][aria-label]') ||
    article.querySelector('.r-18u37iz[role="group"][id^="id__"]');
  if (!actionBar) return;

  const tweetId = currentTweetId(article);
  const meta = readArticleMeta(article, tweetId);
  const hasImages = meta.images && meta.images.length > 0;
  const hasVideo = !!(selectVideoUrl(tweetId) || pickHtmlVideo(article));
  const btn = makeButton(
    [hasVideo ? "下载视频" : null, hasImages ? "下载图片" : null]
      .filter(Boolean)
      .join(" / ") || "下载",
  );

  btn.addEventListener("click", async () => {
    const hydrate = readArticleMeta(article, tweetId);
    const filename = buildFilename(hydrate);
    const tasks = [];

    const videoUrl = selectVideoUrl(tweetId) || pickHtmlVideo(article);
    if (videoUrl) {
      tasks.push(
        scheduleDownload({
          url: videoUrl,
          filename,
          tweetId,
          screenName: hydrate.screenName,
          text: hydrate.text,
          tweetCreatedAt: hydrate.tweetCreatedAt,
        }),
      );
    }

    (hydrate.images || []).forEach((img, index) => {
      const picName = `${filename.replace(/\.mp4$/i, "")}_${String(index + 1).padStart(2, "0")}.jpg`;
      tasks.push(
        scheduleDownload({
          url: img.url,
          filename: picName,
          tweetId,
          screenName: hydrate.screenName,
          text: hydrate.text,
          tweetCreatedAt: hydrate.tweetCreatedAt,
        }),
      );
    });

    if (!tasks.length) return;
    await Promise.all(tasks);
    markDownloaded(btn);
  });

  actionBar.appendChild(btn);
  article.dataset.vkBtnInjected = "1";

  chrome.runtime.sendMessage(
    { type: "VK_CHECK_HISTORY", payload: { tweetId } },
    (res) => {
      if (res?.ok && res.payload?.isExist) markDownloaded(btn);
    },
  );
}

const observer = new MutationObserver(() => {
  document.querySelectorAll('article[role="article"]').forEach(injectButton);
});

function init() {
  hydrateTemplate();
  injectHooks();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.querySelectorAll('article[role="article"]').forEach(injectButton);
}

if (location.host.includes("x.com")) {
  init();
}
