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

// ===================== 连续下载（增量监听）配置与状态 =====================
const INCR_MAX_TASKS = 500; // 最大入队任务数上限
const INCR_MAX_DURATION_MS = 3 * 60 * 1000; // 最长运行时长 3 分钟
const INCR_BATCH_INTERVAL_MS = 800; // 批量下发的节流间隔

const incremental = {
  enabled: false,
  startedAt: 0,
  processedTweetIds: new Set(),
  seenTaskKeys: new Set(),
  pendingTasks: [],
  flushTimer: null,
  io: null,
  btn: null,
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function normalizeVideoUrl(url) {
  try {
    const u = new URL(url, location.origin);
    const parts = (u.pathname || "").split("/");
    const basename = parts[parts.length - 1] || u.pathname || "";
    return `${u.host}/${basename}`;
  } catch (_) {
    return String(url || "");
  }
}

// 规范化视频 URL 用于去重：去掉查询串与 hash，仅保留路径；对 video.twimg.com 常见 mp4 补正规则
// 旧的标准化函数已废弃，统一使用 videoFamilyKey

// 提取 Twitter 视频的“家族键”，用于把不同清晰度/来源的同一视频统一到一组
function videoFamilyKey(url) {
  try {
    const u = new URL(url, location.origin);
    const path = String(u.pathname || "");
    // 优先使用视频 track ID
    let m = path.match(/\/(?:ext_tw_video|amplify_video)\/(\d+)/);
    if (m && m[1]) return `id:${m[1]}`;
    // 其次移除 /vid/<WxH>/ 与文件名，按目录去重
    const strip = path.replace(/\/vid\/\d+x\d+\/[A-Za-z0-9_\-\.]+$/, "/");
    return `dir:${u.host}${strip}`;
  } catch (_) {
    return `norm:${normalizeVideoUrl(url)}`;
  }
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

  // 合并 variants：累积并按 url 去重
  if (patch.variants && Array.isArray(patch.variants)) {
    const merged = [...(prev.variants || [])];
    const seen = new Set(merged.map((v) => v?.url).filter(Boolean));
    patch.variants.forEach((v) => {
      const u = v?.url;
      if (u && !seen.has(u)) {
        seen.add(u);
        merged.push(v);
      }
    });
    next.variants = merged;
  }

  mediaCache.set(tweetId, next);
}

function addVideoUrl(tweetId, url) {
  if (!tweetId || !url) return;
  const meta = mediaCache.get(tweetId) || {};
  const videos = Array.isArray(meta.videos) ? meta.videos.slice() : [];
  if (!videos.includes(url)) videos.push(url);
  mediaCache.set(tweetId, { ...meta, videos });
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
  media.forEach((m) => {
    collectVariants(tweetId, m?.video_info?.variants, {});
    const v = (m?.video_info?.variants || [])
      .filter((x) => /mp4/i.test(x?.content_type || ""))
      .map((x) => x?.url)
      .filter(Boolean);
    v.forEach((u) => addVideoUrl(tweetId, u));
  });
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
  const urls = variants
    .filter((v) => /mp4/i.test(v?.content_type || ""))
    .sort((a, b) => (b?.bitrate || 0) - (a?.bitrate || 0))
    .map((v) => v?.url)
    .filter(Boolean);
  const extra = Array.isArray(meta.videos) ? meta.videos : [];
  const all = [
    ...urls,
    ...(meta.rewrittenUrl ? [meta.rewrittenUrl] : []),
    ...(meta.playbackUrl ? [rewritePlaylist(meta.playbackUrl)] : []),
    ...extra,
  ].filter(Boolean);
  return all[0];
}

// 返回该推文可用的所有视频直链，去重并保序（variants 优先，其次 rewrites/playbackUrl，最后补齐 extra）
function selectAllVideoUrls(tweetId) {
  const meta = mediaCache.get(tweetId) || {};
  const variants = Array.isArray(meta.variants) ? meta.variants : [];
  // 将 variants 按“视频家族键”（ext_tw_video / amplify_video 的数值ID或目录）分组，每组取最高 bitrate 的 mp4
  const groups = new Map();
  variants
    .filter((v) => /mp4/i.test(v?.content_type || ""))
    .forEach((v) => {
      const url = v?.url;
      if (!url) return;
      const familyKey = videoFamilyKey(url);
      const prev = groups.get(familyKey);
      if (!prev || (v?.bitrate || 0) > (prev?.bitrate || 0))
        groups.set(familyKey, v);
    });
  const bestPerGroup = Array.from(groups.values())
    .sort((a, b) => (b?.bitrate || 0) - (a?.bitrate || 0))
    .map((v) => v.url);

  const extras = [
    ...(meta.rewrittenUrl ? [meta.rewrittenUrl] : []),
    ...(meta.playbackUrl ? [rewritePlaylist(meta.playbackUrl)] : []),
    ...(Array.isArray(meta.videos) ? meta.videos : []),
  ].filter(Boolean);

  // 合并 extras，但按“视频家族键”去重，避免与 bestPerGroup 重复
  const uniq = [];
  const seen = new Set(bestPerGroup.map((u) => videoFamilyKey(u)));
  bestPerGroup.forEach((u) => uniq.push(u));
  extras.forEach((u) => {
    const key = videoFamilyKey(u);
    if (key && !seen.has(key)) {
      seen.add(key);
      uniq.push(u);
    }
  });
  return uniq;
}

function pickHtmlVideo(article) {
  const urls = new Set();
  article.querySelectorAll("video, source").forEach((el) => {
    ["src", "currentSrc"].forEach((attr) => {
      const val = el[attr] || el.getAttribute?.(attr);
      if (val && /^https?:/.test(val) && !/^blob:/.test(val)) urls.add(val);
    });
  });
  // 从 poster 派生可回写的 mp4（amplify_video_thumb -> rewritePlaylist）
  article.querySelectorAll("video[poster]").forEach((v) => {
    const poster = v.getAttribute("poster");
    const m = String(poster || "").match(/amplify_video_thumb\/(\d+)\//);
    if (m && m[1]) {
      const meta = mediaCache.get(m[1]);
      const u = meta?.playbackUrl
        ? rewritePlaylist(meta.playbackUrl)
        : undefined;
      if (u) urls.add(u);
    }
  });
  // 规范化并去重，避免同一资源多次添加（用视频家族键去重）
  const uniq = [];
  const seen = new Set();
  // 仅保留可直接下载的 mp4 直链，避免将 m3u8 播放列表误当作视频下载
  Array.from(urls)
    .filter((u) => /\.mp4(?:$|[?#])/i.test(u))
    .forEach((u) => {
      const key = videoFamilyKey(u);
      if (!key) return;
      if (!seen.has(key)) {
        seen.add(key);
        uniq.push(u);
      }
    });
  return uniq;
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

function findTweetIdsInArticle(root) {
  const ids = new Set();
  try {
    root.querySelectorAll('a[href*="/status/"]').forEach((a) => {
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/status\/(\d+)/);
      if (m && m[1]) ids.add(m[1]);
    });
  } catch (_) {}
  return Array.from(ids);
}

function extractPosterIdsFromArticle(root) {
  const ids = new Set();
  const tryExtract = (url) => {
    const m = String(url || "").match(/amplify_video_thumb\/(\d+)\//);
    if (m && m[1]) ids.add(m[1]);
  };
  try {
    root
      .querySelectorAll(
        'video[poster], [style*="amplify_video_thumb"], img[src*="amplify_video_thumb"]',
      )
      .forEach((el) => {
        const poster = el.getAttribute && el.getAttribute("poster");
        if (poster) tryExtract(poster);
        const src = el.getAttribute && el.getAttribute("src");
        if (src) tryExtract(src);
        const style = el.getAttribute && el.getAttribute("style");
        if (style) {
          const m = style.match(/url\(\"?(.*?)\"?\)/);
          if (m && m[1]) tryExtract(m[1]);
        }
      });
  } catch (_) {}
  return Array.from(ids);
}

async function waitForMp4ByTrackIds(trackIds, attempts = 6, intervalMs = 250) {
  const collected = new Set();
  for (let i = 0; i < attempts; i += 1) {
    trackIds.forEach((id) => {
      const url = selectVideoUrl(id);
      if (url) collected.add(url);
    });
    if (collected.size >= trackIds.length) break;
    await sleep(intervalMs);
  }
  return Array.from(collected);
}

function scheduleDownload(payload) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.id) {
        resolve({ ok: false, error: "extension context invalidated" });
        return;
      }
      chrome.runtime.sendMessage({ type: "VK_DOWNLOAD", payload }, (res) => {
        if (chrome.runtime?.lastError) {
          console.warn("runtime sendMessage error", chrome.runtime.lastError);
          resolve({
            ok: false,
            error: chrome.runtime.lastError.message || "runtime error",
          });
          return;
        }
        if (res && !res.ok) console.warn("download failed", res.error);
        resolve(res);
      });
    } catch (error) {
      console.warn("sendMessage failed", error);
      resolve({ ok: false, error: error?.message || String(error) });
    }
  });
}

function scheduleBatchDownload(items) {
  return new Promise((resolve) => {
    try {
      if (!chrome?.runtime?.id) {
        resolve({ ok: false, error: "extension context invalidated" });
        return;
      }
      chrome.runtime.sendMessage(
        { type: "VK_DOWNLOAD_BATCH", payload: { items } },
        (res) => {
          if (chrome.runtime?.lastError) {
            console.warn("runtime sendMessage error", chrome.runtime.lastError);
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message || "runtime error",
            });
            return;
          }
          resolve(res);
        },
      );
    } catch (error) {
      console.warn("sendMessage failed", error);
      resolve({ ok: false, error: error?.message || String(error) });
    }
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
  const hasVideo =
    (selectAllVideoUrls(tweetId) || []).length > 0 ||
    (pickHtmlVideo(article) || []).length > 0;
  // 仅在存在图片或视频时显示下载按钮
  if (!hasImages && !hasVideo) return;
  const btn = makeButton(
    [hasVideo ? "下载视频" : null, hasImages ? "下载图片" : null]
      .filter(Boolean)
      .join(" / ") || "下载",
  );

  btn.addEventListener("click", async () => {
    const hydrate = readArticleMeta(article, tweetId);
    let tasks = buildTasksFromArticle(article);
    // 若只解析到1个视频，尝试轻微滚动以促发懒加载，再次构建任务
    const videoCount = tasks.filter((t) =>
      /video\.twimg\.com|\.mp4/i.test(t.url),
    ).length;
    if (videoCount <= 1) {
      try {
        const prevH = article.scrollHeight || 0;
        article.scrollIntoView({ block: "center" });
        window.scrollBy(0, 120);
        await sleep(120);
        const now = article.scrollHeight || 0;
        if (now >= prevH) {
          const retry = buildTasksFromArticle(article);
          // 合并去重
          const keys = new Set(tasks.map((t) => `${t.url}::${t.filename}`));
          retry.forEach((t) => {
            const k = `${t.url}::${t.filename}`;
            if (!keys.has(k)) {
              keys.add(k);
              tasks.push(t);
            }
          });
        }
      } catch (_) {}
    }
    // 额外处理：若是 blob 播放的首个视频，基于 poster trackId 等待解析到 mp4 后补充
    try {
      const posterIds = extractPosterIdsFromArticle(article);
      if (Array.isArray(posterIds) && posterIds.length) {
        const awaited = await waitForMp4ByTrackIds(posterIds, 6, 250);
        if (Array.isArray(awaited) && awaited.length) {
          const isVideoTask = (t) => /video\.twimg\.com|\.mp4/i.test(t.url);
          const existingVideoUrls = tasks.filter(isVideoTask).map((t) => t.url);
          const existingKeys = new Set(
            existingVideoUrls.map((u) => videoFamilyKey(u)),
          );
          const filenameBase = buildFilename(hydrate);
          let idxStart = existingVideoUrls.length;
          awaited.forEach((u) => {
            const key = videoFamilyKey(u);
            if (!key || existingKeys.has(key)) return;
            const idx = idxStart;
            const name =
              idx === 0
                ? filenameBase
                : filenameBase.replace(
                    /\.mp4$/i,
                    `_${String(idx + 1).padStart(2, "0")}.mp4`,
                  );
            tasks.push({
              url: u,
              filename: name,
              tweetId,
              screenName: hydrate.screenName,
              text: hydrate.text,
              tweetCreatedAt: hydrate.tweetCreatedAt,
            });
            existingKeys.add(key);
            idxStart += 1;
          });
        }
      }
    } catch (_) {}
    // 若仍未构建出任务，做一次保底收集（基于当前可见 DOM 与已解析元数据）
    if (!tasks.length) {
      try {
        const fallbackUrls = new Set();
        (selectAllVideoUrls(tweetId) || []).forEach((u) => fallbackUrls.add(u));
        (pickHtmlVideo(article) || []).forEach((u) => fallbackUrls.add(u));
        const uniqUrls = [];
        const seenKeys = new Set();
        Array.from(fallbackUrls).forEach((u) => {
          const k = videoFamilyKey(u);
          if (!k || seenKeys.has(k)) return;
          seenKeys.add(k);
          uniqUrls.push(u);
        });
        const base = buildFilename(hydrate);
        uniqUrls.forEach((u, idx) => {
          const name =
            idx === 0
              ? base
              : base.replace(
                  /\.mp4$/i,
                  `_${String(idx + 1).padStart(2, "0")}.mp4`,
                );
          tasks.push({
            url: u,
            filename: name,
            tweetId,
            screenName: hydrate.screenName,
            text: hydrate.text,
            tweetCreatedAt: hydrate.tweetCreatedAt,
          });
        });
      } catch (_) {}
    }
    // 如果没有图片任务但按钮提示有图片，尝试从 DOM 提取
    const hasImageTasks = tasks.some((t) =>
      /pbs\.twimg\.com\/media\//i.test(t.url),
    );
    if (!hasImageTasks && hasImages) {
      try {
        const imgs = Array.from(
          article.querySelectorAll(
            '[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media/"]',
          ),
        )
          .map((img) => img.getAttribute("src") || "")
          .filter((src) => /pbs\.twimg\.com\/media\//.test(src))
          .map((src) => src.replace(/(?:\?|&)name=[^&]+/, "?name=orig"));
        imgs.forEach((src, idx) => {
          const base = buildFilename(hydrate).replace(/\.mp4$/i, "");
          const picName = `${base}_${String(idx + 1).padStart(2, "0")}.jpg`;
          tasks.push({
            url: src,
            filename: picName,
            tweetId,
            screenName: hydrate.screenName,
            text: hydrate.text,
            tweetCreatedAt: hydrate.tweetCreatedAt,
          });
        });
      } catch (_) {}
    }
    if (!tasks.length) return;
    for (const task of tasks) {
      try {
        let withExt = task.filename;
        // 确保文件名有正确的扩展名
        if (!/\.\w{2,4}$/i.test(withExt)) {
          const url = task.url || "";
          if (/\.mp4(\?|$|#)/i.test(url) || url.includes("video.twimg.com")) {
            withExt = `${withExt}.mp4`;
          } else if (
            /\.jpg(\?|$|#)/i.test(url) ||
            /\.jpeg(\?|$|#)/i.test(url)
          ) {
            withExt = `${withExt}.jpg`;
          } else if (/\.png(\?|$|#)/i.test(url)) {
            withExt = `${withExt}.png`;
          } else if (/\.gif(\?|$|#)/i.test(url)) {
            withExt = `${withExt}.gif`;
          } else if (/\.webp(\?|$|#)/i.test(url)) {
            withExt = `${withExt}.webp`;
          } else if (url.includes("pbs.twimg.com/media/")) {
            withExt = `${withExt}.jpg`;
          } else if (url.includes("twimg.com")) {
            withExt = `${withExt}.mp4`;
          }
        }
        await scheduleDownload({ ...task, filename: withExt });
      } catch (_) {}
    }
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
  insertGlobalDownloadButton();
});

function init() {
  hydrateTemplate();
  injectHooks();
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  document.querySelectorAll('article[role="article"]').forEach(injectButton);
  insertGlobalDownloadButton();
}

if (location.host.includes("x.com")) {
  init();
}

// ===================== 个人页一键下载按钮 =====================
function isProfilePage() {
  try {
    const seg = location.pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (seg.length === 1 && seg[0]) return true;
    if (seg.length === 2 && ["with_replies", "media", "likes"].includes(seg[1]))
      return true;
  } catch (_) {}
  return false;
}

function buildTasksFromArticle(article) {
  const tweetId = currentTweetId(article);
  const meta = readArticleMeta(article, tweetId);
  // 过滤转推（含“Reposted”/“转推”等标识），但允许本人转推
  const social = article.querySelector('[data-testid="socialContext"]');
  let isRetweet = !!social || /\/retweet\//i.test(article.innerHTML || "");
  if (isRetweet) {
    try {
      const handle = location.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
      const selfLink = handle && social?.querySelector(`a[href="/${handle}"]`);
      if (selfLink) isRetweet = false;
    } catch (_) {}
  }
  if (isRetweet) return [];
  const tasks = [];
  // 收集所有视频直链（GraphQL variants + DOM source）
  const urls = new Set();
  const allForThis = selectAllVideoUrls(tweetId) || [];
  allForThis.forEach((u) => urls.add(u));
  const htmlVideos = pickHtmlVideo(article) || [];
  htmlVideos.forEach((u) => urls.add(u));
  // 收集文章内引用的其它推文的视频
  const innerIds = findTweetIdsInArticle(article).filter(
    (id) => id !== tweetId,
  );
  innerIds.forEach((id) => {
    const list = selectAllVideoUrls(id) || [];
    list.forEach((u) => urls.add(u));
  });
  // 通过 poster 提取的 video track id（针对 blob: 场景）
  const posterIds = extractPosterIdsFromArticle(article);
  posterIds.forEach((id) => {
    const list = selectAllVideoUrls(id) || [];
    list.forEach((u) => urls.add(u));
  });
  const filenameBase = buildFilename(meta);
  // 最终用标准化 key 去重，避免同一视频从不同来源重复
  const uniqueByKey = [];
  const seenKeys = new Set();
  Array.from(urls).forEach((u) => {
    const key = videoFamilyKey(u);
    if (!key) return;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueByKey.push(u);
    }
  });
  uniqueByKey.forEach((u, idx) => {
    const name =
      idx === 0
        ? filenameBase
        : filenameBase.replace(
            /\.mp4$/i,
            `_${String(idx + 1).padStart(2, "0")}.mp4`,
          );
    tasks.push({
      url: u,
      filename: name,
      tweetId,
      screenName: meta.screenName,
      text: meta.text,
      tweetCreatedAt: meta.tweetCreatedAt,
    });
  });
  (meta.images || []).forEach((img, index) => {
    const base = buildFilename(meta).replace(/\.mp4$/i, "");
    const picName = `${base}_${String(index + 1).padStart(2, "0")}.jpg`;
    tasks.push({
      url: img.url,
      filename: picName,
      tweetId,
      screenName: meta.screenName,
      text: meta.text,
      tweetCreatedAt: meta.tweetCreatedAt,
    });
  });
  return tasks;
}

function insertGlobalDownloadButton() {
  if (!isProfilePage()) return;
  if (document.getElementById("vk-page-download-all")) return;
  const btn = document.createElement("button");
  btn.id = "vk-page-download-all";
  btn.type = "button";
  btn.title = "连续下载开关";
  btn.innerHTML =
    '<span style="display:inline-flex;align-items:center;justify-content:center;line-height:1"><svg viewBox="64 64 896 896" width="32" height="32" fill="currentColor" aria-hidden="true"><path d="M928 254.3c-30.6 13.2-63.9 22.7-98.2 26.4a170.1 170.1 0 0075-94 336.64 336.64 0 01-108.2 41.2A170.1 170.1 0 00672 174c-94.5 0-170.5 76.6-170.5 170.6 0 13.2 1.6 26.4 4.2 39.1-141.5-7.4-267.7-75-351.6-178.5a169.32 169.32 0 00-23.2 86.1c0 59.2 30.1 111.4 76 142.1a172 172 0 01-77.1-21.7v2.1c0 82.9 58.6 151.6 136.7 167.4a180.6 180.6 0 01-44.9 5.8c-11.1 0-21.6-1.1-32.2-2.6C211 652 273.9 701.1 348.8 702.7c-58.6 45.9-132 72.9-211.7 72.9-14.3 0-27.5-.5-41.2-2.1C171.5 822 261.2 850 357.8 850 671.4 850 843 590.2 843 364.7c0-7.4 0-14.8-.5-22.2 33.2-24.3 62.3-54.4 85.5-88.2z"></path></svg></span>';
  Object.assign(btn.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: 2147483647,
    width: "55px",
    height: "55px",
    borderRadius: "50%",
    border: "none",
    background: "#000",
    color: "#fff",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,.25)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: "0",
  });
  btn.addEventListener("click", () => toggleIncremental(btn));
  document.documentElement.appendChild(btn);
  incremental.btn = btn;
}

function setToggleVisualState(active) {
  if (!incremental.btn) return;
  incremental.btn.style.background = active ? "#fff" : "#000";
  incremental.btn.style.color = active ? "#000" : "#fff";
  incremental.btn.title = active
    ? "连续下载：已开启（点击关闭）"
    : "连续下载：已关闭（点击开启）";
}

function startIncremental() {
  if (incremental.enabled) return;
  incremental.enabled = true;
  incremental.startedAt = Date.now();
  incremental.processedTweetIds.clear();
  incremental.seenTaskKeys.clear();
  incremental.pendingTasks = [];
  // 先立即扫一遍已加载
  collectVisibleIntoPending();
  // 建立 IntersectionObserver，增量发现新 article
  const io = new IntersectionObserver(
    (entries) => {
      if (!incremental.enabled) return;
      for (const e of entries) {
        if (e.isIntersecting) collectArticleIntoPending(e.target);
      }
    },
    { root: null, threshold: 0.1 },
  );
  document
    .querySelectorAll('article[role="article"]')
    .forEach((a) => io.observe(a));
  incremental.io = io;
  // 批量节流下发
  incremental.flushTimer = setInterval(
    flushPendingBatch,
    INCR_BATCH_INTERVAL_MS,
  );
  // 监听 DOM 新增，自动对新 article 注册观察
  const domObserver = new MutationObserver((mutations) => {
    if (!incremental.enabled) return;
    mutations.forEach((m) => {
      m.addedNodes &&
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n.matches && n.matches('article[role="article"]')) io.observe(n);
          n.querySelectorAll &&
            n
              .querySelectorAll('article[role="article"]')
              .forEach((a) => io.observe(a));
        });
    });
  });
  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  incremental.domObserver = domObserver;
  // 超时/数量上限守卫
  setTimeout(() => {
    if (!incremental.enabled) return;
    stopIncremental();
  }, INCR_MAX_DURATION_MS);
  setToggleVisualState(true);
}

function stopIncremental() {
  incremental.enabled = false;
  if (incremental.io) {
    try {
      incremental.io.disconnect();
    } catch (_) {}
    incremental.io = null;
  }
  if (incremental.domObserver) {
    try {
      incremental.domObserver.disconnect();
    } catch (_) {}
    incremental.domObserver = null;
  }
  if (incremental.flushTimer) {
    clearInterval(incremental.flushTimer);
    incremental.flushTimer = null;
  }
  incremental.pendingTasks = [];
  setToggleVisualState(false);
}

function toggleIncremental(btn) {
  incremental.btn = btn || incremental.btn;
  if (incremental.enabled) stopIncremental();
  else startIncremental();
}

function collectArticleIntoPending(article) {
  const list = buildTasksFromArticle(article);
  // 如果图像未被 GraphQL 元数据捕获，回退从 DOM 提取
  if (!list.length) {
    try {
      const tweetId = currentTweetId(article);
      const meta = readArticleMeta(article, tweetId);
      const imgs = Array.from(
        article.querySelectorAll(
          '[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media/"]',
        ),
      )
        .map((img) => img.getAttribute("src") || "")
        .filter((src) => /pbs.twimg.com\/media\//.test(src))
        .map((src) => src.replace(/(?:\?|&)name=[^&]+/, "?name=orig"));
      imgs.forEach((src, idx) => {
        const base = buildFilename(meta).replace(/\.mp4$/i, "");
        const picName = `${base}_${String(idx + 1).padStart(2, "0")}.jpg`;
        list.push({
          url: src,
          filename: picName,
          tweetId,
          screenName: meta.screenName,
          text: meta.text,
          tweetCreatedAt: meta.tweetCreatedAt,
        });
      });
    } catch (_) {}
  }
  list.forEach((t) => {
    const key = `${t.url}::${t.filename}`;
    if (!incremental.seenTaskKeys.has(key)) {
      incremental.seenTaskKeys.add(key);
      incremental.pendingTasks.push(t);
    }
  });
}

function collectVisibleIntoPending() {
  document
    .querySelectorAll('article[role="article"]')
    .forEach(collectArticleIntoPending);
}

async function flushPendingBatch() {
  if (!incremental.enabled) return;
  if (!incremental.pendingTasks.length) return;
  // 上限保护
  const remain = Math.max(
    0,
    INCR_MAX_TASKS - incremental.processedTweetIds.size,
  );
  if (remain <= 0) {
    stopIncremental();
    return;
  }
  const batch = incremental.pendingTasks.splice(0, Math.min(50, remain));
  // 去除已下载
  const tweetIds = Array.from(
    new Set(batch.map((t) => t.tweetId).filter(Boolean)),
  );
  let existing = [];
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "VK_CHECK_HISTORY_BATCH", payload: { tweetIds } },
        (r) => resolve(r),
      );
    });
    if (res?.ok) existing = res.payload?.existing || [];
  } catch (_) {}
  const existingSet = new Set(existing.map(String));
  const finalTasks = batch.filter((t) => !existingSet.has(String(t.tweetId)));
  if (!finalTasks.length) return;
  await scheduleBatchDownload(finalTasks);
  finalTasks.forEach((t) =>
    incremental.processedTweetIds.add(String(t.tweetId)),
  );
}
