/* global chrome */

// ===== 侧边栏保持点击扩展图标自动打开 =====
try {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
} catch (_) {}

// ===== 全局配置 =====
const VK_X_TWEET_MEDIA = new Map(); // tweetId -> Array<{url, bitrate, content_type}>
const VK_X_MEDIA_METADATA = new Map(); // tweetId -> metadata
const VK_SETTINGS_KEY = "video_keep_settings";
const VK_DEFAULT_TEMPLATE = "{screenName}_{userId}_{tweetTime}_{random}";
let VK_FILENAME_TEMPLATE = VK_DEFAULT_TEMPLATE;

function loadTemplateOnce() {
  try {
    if (chrome.storage?.local) {
      chrome.storage.local.get([VK_SETTINGS_KEY], (result) => {
        if (chrome.runtime?.lastError) return;
        const value = result?.[VK_SETTINGS_KEY];
        if (value?.filenameTemplate) {
          VK_FILENAME_TEMPLATE = value.filenameTemplate;
        }
      });
      chrome.storage.onChanged?.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        const change = changes?.[VK_SETTINGS_KEY];
        if (change?.newValue?.filenameTemplate) {
          VK_FILENAME_TEMPLATE = change.newValue.filenameTemplate;
        }
      });
    } else {
      const cached = localStorage.getItem(VK_SETTINGS_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.filenameTemplate) {
            VK_FILENAME_TEMPLATE = parsed.filenameTemplate;
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
}

loadTemplateOnce();

function mergeTweetMetadata(tweetId, patch) {
  if (!tweetId || !patch) return;
  const existed = VK_X_MEDIA_METADATA.get(tweetId) || {};
  const mergedImages = [...(existed.images || [])];
  if (Array.isArray(patch.images)) {
    patch.images.forEach((img) => {
      if (!img?.url) return;
      if (!mergedImages.some((item) => item.url === img.url)) {
        mergedImages.push(img);
      }
    });
  }
  const next = {
    ...existed,
    ...patch,
    images: mergedImages,
  };
  VK_X_MEDIA_METADATA.set(tweetId, next);
}

function collectImagesFromLegacy(tweetId, media = []) {
  if (!tweetId || !Array.isArray(media)) return;
  const images = media
    .filter(
      (m) =>
        (m?.type === "photo" || m?.type === "animated_gif") &&
        m?.media_url_https,
    )
    .map((m) => {
      let url = m.media_url_https || m.media_url || m.url;
      if (url && !/:(?:large|orig)$/.test(url)) {
        url = `${url}:orig`;
      }
      return {
        url,
        type: m.type,
        id: m.id_str || m.id,
      };
    })
    .filter((x) => x.url);
  if (images.length) {
    mergeTweetMetadata(tweetId, { images });
  }
}

function upsertTweetVariants(tweetId, variants, extra = {}) {
  if (!tweetId || !Array.isArray(variants) || variants.length === 0) {
    mergeTweetMetadata(tweetId, extra);
    return;
  }
  const mp4s = variants.filter((v) => /mp4/i.test(v?.content_type || ""));
  if (mp4s.length === 0) {
    mergeTweetMetadata(tweetId, extra);
    return;
  }
  const existed = VK_X_TWEET_MEDIA.get(tweetId) || [];
  const key = (v) => `${v.url}`;
  const map = new Map(existed.map((v) => [key(v), v]));
  mp4s.forEach((v) => map.set(key(v), v));
  VK_X_TWEET_MEDIA.set(tweetId, Array.from(map.values()));
  mergeTweetMetadata(tweetId, { variants: mp4s, ...extra });
}

function parseTwitterDate(str) {
  if (!str) return undefined;
  const ts = Date.parse(str);
  if (Number.isNaN(ts)) return undefined;
  return ts;
}

function extractUserFromNode(node) {
  const userResult =
    node?.core?.user_results?.result ||
    node?.core?.user_result_by_id?.result ||
    node?.author?.result ||
    node?.author ||
    node?.user_result?.result;
  const legacy = userResult?.legacy || node?.user?.legacy || userResult;
  if (!legacy) return {};
  return {
    screenName:
      legacy.screen_name ||
      legacy.username ||
      userResult?.legacy?.screen_name ||
      userResult?.legacy?.username,
    userId: legacy.id_str || legacy.id || userResult?.rest_id,
    name: legacy.name,
  };
}

function handleTweetLegacy(container) {
  if (!container) return;
  const legacy = container.legacy || container.tweet?.legacy || container;
  if (!legacy) return;
  const tweetId =
    container.rest_id || container.tweet?.rest_id || legacy.id_str || legacy.id;
  if (!tweetId) return;

  const createdAt = parseTwitterDate(legacy.created_at);
  const text = legacy.full_text || legacy.text || legacy.extended?.tweet_text;
  const userInfo = extractUserFromNode(container);
  const userId = legacy.user_id_str || legacy.user_id || userInfo.userId;
  const screenName = userInfo.screenName;

  mergeTweetMetadata(tweetId, {
    tweetCreatedAt: createdAt,
    text: text || undefined,
    screenName: screenName || undefined,
    username: userInfo.displayName || userInfo.name,
    userId: userId || undefined,
    tweetId,
  });

  const media = legacy.extended_entities?.media || legacy.entities?.media || [];
  collectImagesFromLegacy(tweetId, media);
  media.forEach((m) => {
    const variants = m?.video_info?.variants || [];
    upsertTweetVariants(tweetId, variants, {
      tweetCreatedAt: createdAt,
      text: text || undefined,
      screenName: screenName || undefined,
      username: userInfo.displayName || userInfo.name,
      userId: userId || undefined,
      tweetId,
    });
  });
}

function tryCollectFromTweetNode(node) {
  if (!node || typeof node !== "object") return;
  handleTweetLegacy(node);
  if (node.tweet) handleTweetLegacy(node.tweet);
  if (node.result) tryCollectFromTweetNode(node.result);
  if (node.tweet_results) tryCollectFromTweetNode(node.tweet_results);
  if (node.threaded_conversation_with_injections_v2) {
    tryCollectFromTweetNode(node.threaded_conversation_with_injections_v2);
  }
}

function traverseCollectTweetVariants(obj) {
  if (!obj || typeof obj !== "object") return;
  tryCollectFromTweetNode(obj);
  for (const k in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
    const val = obj[k];
    if (Array.isArray(val)) {
      val.forEach((it) => traverseCollectTweetVariants(it));
    } else if (val && typeof val === "object") {
      traverseCollectTweetVariants(val);
    }
  }
}

function handleMediaResponseEvent(ev) {
  try {
    const detail = ev?.detail || {};
    const path = detail.path || "";
    if (/\/graphql\//.test(path)) {
      const body = detail.body;
      if (!body) return;
      const json = JSON.parse(body);
      traverseCollectTweetVariants(json);
      return;
    }
    if (/\/videos?\/tweet\/config\//.test(path)) {
      const body = detail.body;
      if (!body) return;
      const json = JSON.parse(body);
      const tweetId = json?.track?.id || json?.tweet_id || json?.tweetId;
      const playbackUrl = json?.track?.playbackUrl || json?.playbackUrl;
      const variants =
        json?.track?.variants ||
        json?.variants ||
        json?.track?.media?.variants ||
        [];
      if (tweetId) {
        mergeTweetMetadata(tweetId, {
          tweetId,
          screenName: json?.track?.author?.screen_name,
          userId: json?.track?.author?.id_str,
        });
        upsertTweetVariants(tweetId, variants, {
          playbackUrl,
          source: "tweet_config",
        });
        if (playbackUrl) {
          const mp4 = tryRewritePlaylistToMp4(playbackUrl);
          if (mp4) {
            upsertTweetVariants(
              tweetId,
              [{ url: mp4, content_type: "video/mp4" }],
              {
                playbackUrl,
                rewrittenUrl: mp4,
                source: "tweet_config_rewrite",
              },
            );
          }
        }
      }
      return;
    }
    const body = detail.body;
    if (!body) return;
    const json = JSON.parse(body);
    traverseCollectTweetVariants(json);
  } catch (_) {}
}

let pageHooksInjected = false;

function injectPageHooksOnce() {
  if (pageHooksInjected) return;
  const url = chrome.runtime?.getURL?.("injected-hooks.js");
  if (!url) {
    setTimeout(injectPageHooksOnce, 100);
    return;
  }
  const script = document.createElement("script");
  script.id = "vk-x-hooks";
  script.type = "text/javascript";
  script.src = url;
  script.onload = () => {
    script.remove();
    pageHooksInjected = true;
  };
  script.onerror = () => {
    pageHooksInjected = false;
    setTimeout(injectPageHooksOnce, 500);
  };
  (document.head || document.documentElement).appendChild(script);
}

document.addEventListener("mh:media-response", handleMediaResponseEvent);
document.addEventListener("mh:media-blob", () => {});

function sanitizeFilename(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

function generateRandomString(len = 6) {
  const chars = "ABCDEFGHJKMNPQRSTWXYZ2345678";
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function formatTweetTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function buildFilename(meta = {}) {
  const template = VK_FILENAME_TEMPLATE || VK_DEFAULT_TEMPLATE;
  const tweetTime = meta.tweetCreatedAt
    ? formatTweetTime(meta.tweetCreatedAt)
    : formatTweetTime(Date.now());
  const replacements = {
    screenName: sanitizeFilename(meta.screenName || meta.handle || "user"),
    username: sanitizeFilename(meta.username || meta.displayName || "user"),
    userId: sanitizeFilename(
      meta.username || meta.displayName || meta.screenName || "user",
    ),
    tweetTime: sanitizeFilename(tweetTime || "time"),
    tweetId: sanitizeFilename(meta.tweetId || "tweet"),
    random: sanitizeFilename(generateRandomString(6)),
    text: sanitizeFilename((meta.text || "").slice(0, 30)),
  };

  let result = template.replace(
    /\{(screenName|username|userId|tweetTime|tweetId|random|text)\}/g,
    (match, key) => {
      return replacements[key] || "";
    },
  );

  result = result.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  const folder = replacements.screenName || "user";
  if (!/\.\w{2,4}$/.test(result)) {
    result = `${result || "video"}.mp4`;
  }
  return `${folder}/${result}`;
}

function getTweetMetadata(tweetId) {
  if (!tweetId) return {};
  return VK_X_MEDIA_METADATA.get(tweetId) || {};
}

function pickBestMp4(variants = []) {
  const mp4s = variants.filter((v) => /mp4/i.test(v?.content_type || ""));
  if (mp4s.length === 0) return undefined;
  mp4s.sort((a, b) => (b?.bitrate || 0) - (a?.bitrate || 0));
  return mp4s[0];
}

function pickVideoUrlFromArticle(article) {
  const urls = new Set();
  const collect = (value) => {
    if (!value) return;
    const url = String(value).trim();
    if (!url) return;
    if (/^blob:/.test(url) || /^data:/.test(url)) return;
    urls.add(url);
  };

  const videos = article.querySelectorAll("video");
  videos.forEach((video) => {
    collect(video.getAttribute?.("src"));
    collect(video.src);
    collect(video.currentSrc);
    video.querySelectorAll("source").forEach((source) => {
      collect(source.getAttribute?.("src"));
      collect(source.src);
    });
  });

  article.querySelectorAll("source").forEach((source) => {
    collect(source.getAttribute?.("src"));
    collect(source.src);
  });

  const preferences = [
    (url) => /^https?:/.test(url) && /video\.twimg\.com/.test(url),
    (url) => /^https?:/.test(url) && /\.mp4($|[?#])/.test(url),
    (url) => {
      if (/^https?:/.test(url) && /\.m3u8($|[?#])/.test(url)) {
        const rewritten = tryRewritePlaylistToMp4(url);
        if (rewritten) {
          urls.add(rewritten);
          return true;
        }
      }
      return false;
    },
    (url) => /^https?:/.test(url),
    () => true,
  ];

  const list = Array.from(urls);
  for (const matcher of preferences) {
    const found = list.find((url) => matcher(url));
    if (found) return found;
  }
  return undefined;
}

function parseNamesFromArticle(article) {
  const block = article.querySelector('[data-testid="User-Name"]');
  let displayName;
  let handle;
  if (block) {
    const spanNodes = block.querySelectorAll("span");
    spanNodes.forEach((node) => {
      if (handle && displayName) return;
      const text = node?.textContent?.trim();
      if (!text) return;
      if (text.startsWith("@")) {
        handle = text.slice(1);
      } else if (!displayName) {
        displayName = text;
      }
    });
  }
  if (!handle) {
    const handleNode = article.querySelector(
      '[data-testid="User-Name"] a[role="link"][tabindex="-1"] span',
    );
    const text = handleNode?.textContent?.trim();
    if (text?.startsWith("@")) handle = text.slice(1);
  }
  if (!displayName) {
    const displayNode = article.querySelector(
      '[data-testid="User-Name"] span[dir="ltr"], [data-testid="User-Name"] div[dir="ltr"]',
    );
    displayName = displayNode?.textContent?.trim();
  }
  return { displayName, handle };
}

function getArticleMeta(article, tweetId) {
  const stored = getTweetMetadata(tweetId);
  const { displayName, handle } = parseNamesFromArticle(article);
  const username =
    stored.username ||
    displayName ||
    article
      .querySelector('a[role="link"][href^="/"] header span')
      ?.textContent?.trim() ||
    "user";
  const resolvedHandle =
    stored.screenName || handle || stored.username || username;

  const text =
    stored.text ||
    article
      .querySelector('h1, h2, h3, [data-testid="tweetText"], article')
      ?.textContent?.trim()
      ?.slice(0, 30) ||
    "";
  return {
    username,
    displayName: username,
    screenName: resolvedHandle,
    handle: resolvedHandle,
    text,
    tweetCreatedAt: stored.tweetCreatedAt,
    images: stored.images || [],
  };
}

function makeDownloadButton() {
  const btn = document.createElement("button");
  btn.className = "vk-tweet-download-btn";
  btn.innerHTML = `
    <span style="display:inline-flex;align-items:center;justify-content:center;line-height:1">
      <svg
        viewBox="64 64 896 896"
        focusable="false"
        aria-hidden="true"
        width="18"
        height="18"
        fill="currentColor"
      >
        <path d="M624 706.3h-74.1V464c0-4.4-3.6-8-8-8h-60c-4.4 0-8 3.6-8 8v242.3H400c-6.7 0-10.4 7.7-6.3 12.9l112 141.7a8 8 0 0012.6 0l112-141.7c4.1-5.2.4-12.9-6.3-12.9z"></path>
        <path d="M811.4 366.7C765.6 245.9 648.9 160 512.2 160S258.8 245.8 213 366.6C127.3 389.1 64 467.2 64 560c0 110.5 89.5 200 199.9 200H304c4.4 0 8-3.6 8-8v-60c0-4.4-3.6-8-8-8h-40.1c-33.7 0-65.4-13.4-89-37.7-23.5-24.2-36-56.8-34.9-90.6.9-26.4 9.9-51.2 26.2-72.1 16.7-21.3 40.1-36.8 66.1-43.7l37.9-9.9 13.9-36.6c8.6-22.8 20.6-44.1 35.7-63.4a245.6 245.6 0 0152.4-49.9c41.1-28.9 89.5-44.2 140-44.2s98.9 15.3 140 44.2c19.9 14 37.5 30.8 52.4 49.9 15.1 19.3 27.1 40.7 35.7 63.4l13.8 36.5 37.8 10C846.1 454.5 884 503.8 884 560c0 33.1-12.9 64.3-36.3 87.7a123.07 123.07 0 01-87.6 36.3H720c-4.4 0-8 3.6-8 8v60c0 4.4 3.6 8 8 8h40.1C870.5 760 960 670.5 960 560c0-92.7-63.1-170.7-148.6-193.3z"></path>
      </svg>
    </span>
  `;
  btn.setAttribute("type", "button");
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
    fontSize: "12px",
  });
  return btn;
}

function markButtonDownloaded(btn) {
  btn.disabled = true;
  btn.innerHTML = `
    <span style="display:inline-flex;align-items:center;justify-content:center;line-height:1">
      <svg
        viewBox="64 64 896 896"
        focusable="false"
        aria-hidden="true"
        width="18"
        height="18"
        fill="currentColor"
      >
        <path d="M704 446H320c-4.4 0-8 3.6-8 8v402c0 4.4 3.6 8 8 8h384c4.4 0 8-3.6 8-8V454c0-4.4-3.6-8-8-8zm-328 64h272v117H376V510zm272 290H376V683h272v117z"></path>
        <path d="M424 748a32 32 0 1064 0 32 32 0 10-64 0zm0-178a32 32 0 1064 0 32 32 0 10-64 0z"></path>
        <path d="M811.4 368.9C765.6 248 648.9 162 512.2 162S258.8 247.9 213 368.8C126.9 391.5 63.5 470.2 64 563.6 64.6 668 145.6 752.9 247.6 762c4.7.4 8.7-3.3 8.7-8v-60.4c0-4-3-7.4-7-7.9-27-3.4-52.5-15.2-72.1-34.5-24-23.5-37.2-55.1-37.2-88.6 0-28 9.1-54.4 26.2-76.4 16.7-21.4 40.2-36.9 66.1-43.7l37.9-10 13.9-36.7c8.6-22.8 20.6-44.2 35.7-63.5 14.9-19.2 32.6-36 52.4-50 41.1-28.9 89.5-44.2 140-44.2s98.9 15.3 140 44.3c19.9 14 37.5 30.8 52.4 50 15.1 19.3 27.1 40.7 35.7 63.5l13.8 36.6 37.8 10c54.2 14.4 92.1 63.7 92.1 120 0 33.6-13.2 65.1-37.2 88.6-19.5 19.2-44.9 31.1-71.9 34.5-4 .5-6.9 3.9-6.9 7.9V754c0 4.7 4.1 8.4 8.8 8 101.7-9.2 182.5-94 183.2-198.2.6-93.4-62.7-172.1-148.6-194.9z"></path>
      </svg>
    </span>
  `;
  btn.style.color = "#8b8b8b";
  btn.style.border = "none";
  btn.style.cursor = "not-allowed";
}

function checkAndMarkDownloaded(article, btn) {
  const tweetId = getTweetIdFromArticle(article);
  if (!tweetId) return;
  try {
    chrome.runtime.sendMessage(
      { type: "VK_CHECK_HISTORY", payload: { tweetId } },
      (res) => {
        if (res && res.ok && res.payload && res.payload.isExist) {
          markButtonDownloaded(btn);
        }
      },
    );
  } catch (_) {}
}

function getTweetIdFromArticle(article) {
  const timeEl = article.querySelector('a[href*="/status/"] time');
  if (timeEl) {
    const a = timeEl.closest('a[href*="/status/"]');
    if (a && a.getAttribute) {
      const href = a.getAttribute("href") || "";
      const m =
        href.match(/\/_?status\/(\d+)/) || href.match(/\/status\/(\d+)/);
      if (m) return m[1];
    }
  }
  const roleLink = article.querySelector('a[role="link"][href*="/status/"]');
  if (roleLink && roleLink.getAttribute) {
    const href = roleLink.getAttribute("href") || "";
    const m = href.match(/\/_?status\/(\d+)/) || href.match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  const any = article.querySelector('a[href*="/status/"]');
  if (any && any.getAttribute) {
    const href = any.getAttribute("href") || "";
    const m = href.match(/\/_?status\/(\d+)/) || href.match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  const el = article.querySelector("[data-tweet-id]");
  if (el) return el.getAttribute("data-tweet-id");
  return undefined;
}

function selectBestUrl(tweetId) {
  if (!tweetId) return undefined;
  const meta = VK_X_MEDIA_METADATA.get(tweetId) || {};
  const variants = VK_X_TWEET_MEDIA.get(tweetId) || meta.variants || [];
  if (variants && variants.length) {
    const best = pickBestMp4(variants);
    if (best?.url) return best.url;
  }
  if (meta.rewrittenUrl) return meta.rewrittenUrl;
  if (meta.playbackUrl) {
    const mp4 = tryRewritePlaylistToMp4(meta.playbackUrl);
    if (mp4) return mp4;
  }
  return undefined;
}

function injectButtonForArticle(article) {
  if (!article || article.dataset.vkBtnInjected === "1") return;
  const actionBar =
    article.querySelector('[role="group"][aria-label]') ||
    article.querySelector('.r-18u37iz[role="group"][id^="id__"]');
  if (!actionBar) return;
  const btn = makeDownloadButton();
  btn.addEventListener("click", () => {
    const tweetId = getTweetIdFromArticle(article);
    const metaFromArticle = getArticleMeta(article, tweetId);
    const storeMeta = getTweetMetadata(tweetId);
    const combinedMeta = {
      ...storeMeta,
      ...metaFromArticle,
      tweetId: tweetId || storeMeta.tweetId,
    };
    const hasImages = combinedMeta.images && combinedMeta.images.length > 0;
    const tooltipParts = [];
    if (selectBestUrl(tweetId) || pickVideoUrlFromArticle(article)) {
      tooltipParts.push("下载视频");
    }
    if (hasImages) {
      tooltipParts.push("下载图片");
    }
    btn.setAttribute("title", tooltipParts.join(" / ") || "下载");

    let url = selectBestUrl(tweetId);
    if (!url && !hasImages) {
      url = pickVideoUrlFromArticle(article);
    }
    if (!url && !hasImages) return;

    const filename = buildFilename(combinedMeta);
    const downloads = [];

    if (url) {
      downloads.push(
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: "VK_DOWNLOAD",
              payload: {
                url,
                filename,
                tweetId: tweetId || null,
                screenName:
                  combinedMeta.screenName || combinedMeta.username || null,
                text: combinedMeta.text || null,
                userId: combinedMeta.screenName || null,
                tweetCreatedAt: combinedMeta.tweetCreatedAt || null,
              },
            },
            (res) => {
              if (res && !res.ok) {
                console.warn("download failed", res.error);
              }
              resolve(res);
            },
          );
        }),
      );
    }

    if (hasImages) {
      combinedMeta.images.forEach((img, index) => {
        const imageFilename = `${filename.replace(/\.mp4$/i, "")}_${String(
          index + 1,
        ).padStart(2, "0")}.jpg`;
        downloads.push(
          new Promise((resolve) => {
            chrome.runtime.sendMessage(
              {
                type: "VK_DOWNLOAD",
                payload: {
                  url: img.url,
                  filename: imageFilename,
                  tweetId: tweetId || null,
                  screenName:
                    combinedMeta.screenName || combinedMeta.username || null,
                  text: combinedMeta.text || null,
                  userId: combinedMeta.screenName || null,
                  tweetCreatedAt: combinedMeta.tweetCreatedAt || null,
                },
              },
              (res) => {
                if (res && !res.ok) {
                  console.warn("image download failed", res.error);
                }
                resolve(res);
              },
            );
          }),
        );
      });
    }

    Promise.all(downloads).then(() => {
      markButtonDownloaded(btn);
    });
  });

  actionBar.appendChild(btn);
  article.dataset.vkBtnInjected = "1";
  checkAndMarkDownloaded(article, btn);
}

function scanAndInjectButtons(root = document) {
  const articles = root.querySelectorAll('article[role="article"]');
  articles.forEach((a) => injectButtonForArticle(a));
}

function observeForVideos() {
  const ob = new MutationObserver(() => {
    scanAndInjectButtons();
  });
  ob.observe(document.documentElement, { subtree: true, childList: true });
  scanAndInjectButtons();
}

function tryRewritePlaylistToMp4(url) {
  try {
    const parsed = new URL(url, location.origin);
    if (!/\.m3u8($|[?#])/.test(parsed.pathname)) return undefined;
    const dir = parsed.href.replace(/playlist\.m3u8[^?#]*/, "");
    const qualities = [
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
    const name = parsed.searchParams.get("name") || "video";
    const query = parsed.search || "";
    for (const quality of qualities) {
      const candidate = `${dir}${quality}.mp4${query}`;
      if (candidate) return candidate;
    }
    return parsed.href.replace(/playlist\.m3u8/, `${name}.mp4`);
  } catch (_) {
    return undefined;
  }
}

(() => {
  if (location.host.includes("x.com")) {
    injectPageHooksOnce();
    observeForVideos();
  }
})();
