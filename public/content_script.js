/* global chrome */

// ===== 侧边栏保持点击扩展图标自动打开 =====
try {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
} catch (_) {}

// ===== 复用 TwitterMediaHarvest 思路：捕获 X GraphQL 响应，按 tweetId 收集 mp4 变体 =====
const VK_X_TWEET_MEDIA = new Map(); // tweetId -> Array<{url, bitrate, content_type}>

function upsertTweetVariants(tweetId, variants) {
  if (!tweetId || !Array.isArray(variants) || variants.length === 0) return;
  const mp4s = variants.filter((v) => /mp4/i.test(v?.content_type || ""));
  if (mp4s.length === 0) return;
  const existed = VK_X_TWEET_MEDIA.get(tweetId) || [];
  const key = (v) => `${v.url}`;
  const map = new Map(existed.map((v) => [key(v), v]));
  mp4s.forEach((v) => map.set(key(v), v));
  VK_X_TWEET_MEDIA.set(tweetId, Array.from(map.values()));
}

function tryCollectFromLegacyTweet(node) {
  const legacy = node?.legacy;
  if (!legacy || typeof legacy !== "object") return;
  const tweetId = legacy.id_str || legacy.id;
  const media = legacy.extended_entities?.media || legacy.entities?.media;
  if (!Array.isArray(media)) return;
  media.forEach((m) => {
    const variants = m?.video_info?.variants || [];
    upsertTweetVariants(tweetId, variants || []);
  });
}

function tryCollectFromTweetNode(node) {
  if (!node || typeof node !== "object") return;
  if (node.legacy) tryCollectFromLegacyTweet(node);
  if (node.tweet) tryCollectFromLegacyTweet(node.tweet);
  if (node.result) tryCollectFromTweetNode(node.result);
  if (node.rest_id && node.legacy) tryCollectFromLegacyTweet(node);
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
    if (!/\/graphql\//.test(path)) return;
    const body = detail.body;
    if (!body) return;
    const json = JSON.parse(body);
    traverseCollectTweetVariants(json);
  } catch (_) {}
}

function injectXhrHookOnce() {
  if (document.getElementById("vk-x-xhr-hook")) return;
  const s = document.createElement("script");
  s.id = "vk-x-xhr-hook";
  s.textContent = `(() => {
    const Pattern = /^(?:\\/i\\/api)?\\/graphql\\/[^/]+\\/(TweetDetail|TweetResultByRestId|UserTweets|UserMedia|HomeTimeline|HomeLatestTimeline|UserTweetsAndReplies|UserHighlightsTweets|UserArticlesTweets|Bookmarks|Likes|CommunitiesExploreTimeline|ListLatestTweetsTimeline)$/;
    function validateUrl(u){
      try { return new URL(u); } catch(_) { try { return (u instanceof URL)?u:undefined } catch(_) { return undefined } }
    }
    const _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = new Proxy(_open, {
      apply(target, thisArg, args){
        const [method, url] = args;
        const u = validateUrl(url) || (typeof url === 'string' ? new URL(url, location.origin) : undefined);
        if (u && Pattern.test(u.pathname)) {
          thisArg.addEventListener('load', function(){
            try {
              if (this.status === 200) {
                const ev = new CustomEvent('mh:media-response', { detail: { path: u.pathname, body: this.responseText, status: this.status } });
                document.dispatchEvent(ev);
              }
            } catch(_) {}
          });
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
  })();`;
  (document.head || document.documentElement).appendChild(s);
}

function injectFetchHookOnce() {
  if (document.getElementById("vk-x-fetch-hook")) return;
  const s = document.createElement("script");
  s.id = "vk-x-fetch-hook";
  s.textContent = `(() => {
    const Pattern = /^(?:\\/i\\/api)?\\/graphql\\/[^/]+\\/(TweetDetail|TweetResultByRestId|UserTweets|UserMedia|HomeTimeline|HomeLatestTimeline|UserTweetsAndReplies|UserHighlightsTweets|UserArticlesTweets|Bookmarks|Likes|CommunitiesExploreTimeline|ListLatestTweetsTimeline)$/;
    function validateUrl(u){
      try { return new URL(u); } catch(_) { try { return (u instanceof URL)?u:undefined } catch(_) { return undefined } }
    }
    const _fetch = window.fetch;
    window.fetch = new Proxy(_fetch, {
      apply(target, thisArg, args){
        try {
          const [input, init] = args;
          const method = (init && init.method) || 'GET';
          let href;
          if (typeof input === 'string') href = input; else if (input && typeof input.url === 'string') href = input.url;
          const u = href ? (validateUrl(href) || new URL(href, location.origin)) : undefined;
          if (u && Pattern.test(u.pathname)) {
            return Reflect.apply(target, thisArg, args).then(async (resp) => {
              try {
                const cloned = resp.clone();
                const text = await cloned.text();
                const ev = new CustomEvent('mh:media-response', { detail: { path: u.pathname, body: text, status: resp.status, method } });
                document.dispatchEvent(ev);
              } catch(_) {}
              return resp;
            });
          }
        } catch(_) {}
        return Reflect.apply(target, thisArg, args);
      }
    });
  })()`;
  (document.head || document.documentElement).appendChild(s);
}

document.addEventListener("mh:media-response", handleMediaResponseEvent);

// ===== 每条推文注入“下载”按钮 =====
function getTweetIdFromArticle(article) {
  // 优先：包含 <time> 的永久链接（更可能指向主贴）
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
  // 次选：role=link 的状态链接
  const roleLink = article.querySelector('a[role="link"][href*="/status/"]');
  if (roleLink && roleLink.getAttribute) {
    const href = roleLink.getAttribute("href") || "";
    const m = href.match(/\/_?status\/(\d+)/) || href.match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  // 兜底：任意 /status/ 链接
  const any = article.querySelector('a[href*="/status/"]');
  if (any && any.getAttribute) {
    const href = any.getAttribute("href") || "";
    const m = href.match(/\/_?status\/(\d+)/) || href.match(/\/status\/(\d+)/);
    if (m) return m[1];
  }
  // 超兜底：自定义属性
  const el = article.querySelector("[data-tweet-id]");
  if (el) return el.getAttribute("data-tweet-id");
  return undefined;
}

function pickBestMp4(variants = []) {
  const mp4s = variants.filter((v) => /mp4/i.test(v?.content_type || ""));
  if (mp4s.length === 0) return undefined;
  mp4s.sort((a, b) => (b?.bitrate || 0) - (a?.bitrate || 0));
  return mp4s[0];
}

function buildFilename(meta = {}) {
  const { username = "user", userId = "uid", text = "" } = meta;
  const safe = (s) => (s || "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return `${safe(username)}_${safe(userId)}_${safe(text)}_${Date.now()}.mp4`;
}

function getArticleMeta(article) {
  const username =
    article
      .querySelector('a[role="link"][href^="/"], header a')
      ?.textContent?.trim() || "user";
  const text =
    article
      .querySelector('h1, h2, h3, [data-testid="tweetText"], article')
      ?.textContent?.trim()
      ?.slice(0, 30) || "";
  const userId = location.pathname.split("/").filter(Boolean)[0] || "uid";
  return { username, userId, text };
}

function makeDownloadButton() {
  const btn = document.createElement("button");
  btn.className = "vk-tweet-download-btn";
  btn.textContent = "下载";
  Object.assign(btn.style, {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 8px",
    marginLeft: "8px",
    borderRadius: "999px",
    border: "1px solid rgba(29,155,240,0.35)",
    background: "transparent",
    color: "rgb(29,155,240)",
    cursor: "pointer",
    fontSize: "12px",
  });
  return btn;
}

function markButtonDownloaded(btn) {
  btn.textContent = "已下载";
  btn.disabled = true;
  btn.style.color = "#8b8b8b";
  btn.style.borderColor = "#d9d9d9";
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

function injectButtonForArticle(article) {
  if (!article || article.dataset.vkBtnInjected === "1") return;
  const actionBar =
    article.querySelector('[role="group"][aria-label]') ||
    article.querySelector('.r-18u37iz[role="group"][id^="id__"]');
  if (!actionBar) return;
  const btn = makeDownloadButton();
  btn.addEventListener("click", () => {
    const tweetId = getTweetIdFromArticle(article);
    const meta = getArticleMeta(article);
    let url;
    if (tweetId && VK_X_TWEET_MEDIA.has(tweetId)) {
      const best = pickBestMp4(VK_X_TWEET_MEDIA.get(tweetId));
      url = best && best.url;
    }
    if (!url) {
      const v = article.querySelector("video, source");
      url = v?.src || v?.getAttribute?.("src");
    }
    if (!url) return;
    chrome.runtime.sendMessage(
      {
        type: "VK_DOWNLOAD",
        payload: {
          url,
          filename: buildFilename(meta),
          tweetId: tweetId || null,
          screenName: meta.username || null,
          text: meta.text || null,
        },
      },
      (res) => {
        if (res && !res.ok) {
          console.warn("download failed", res.error);
        }
        if (res && res.ok) {
          markButtonDownloaded(btn);
        }
      },
    );
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

(() => {
  if (location.host.includes("x.com")) {
    injectXhrHookOnce();
    injectFetchHookOnce();
    observeForVideos();
  }
})();
