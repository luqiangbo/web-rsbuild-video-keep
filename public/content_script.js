/* global chrome */

function findInstagramVideoUrls() {
  const urls = new Set();
  document.querySelectorAll("video").forEach((v) => {
    if (v.src) urls.add(v.src);
    v.querySelectorAll("source").forEach((s) => s.src && urls.add(s.src));
  });
  // 兜底从网络资源标签中寻找（如有 data-*）
  document.querySelectorAll("[data-video-url]").forEach((el) => {
    const u = el.getAttribute("data-video-url");
    if (u) urls.add(u);
  });
  return Array.from(urls);
}

function buildFilename(meta = {}) {
  const { username = "user", userId = "uid", text = "" } = meta;
  const safe = (s) => (s || "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return `${safe(username)}_${safe(userId)}_${safe(text)}_${Date.now()}.mp4`;
}

function getPageMeta() {
  // 简化：尝试从 DOM 获取用户名/文案
  const username =
    document.querySelector('header a, a[role="link"]')?.textContent?.trim() ||
    "user";
  const text =
    document
      .querySelector("h1, h2, h3, article")
      ?.textContent?.trim()
      ?.slice(0, 30) || "";
  const userId = location.pathname.split("/").filter(Boolean)[0] || "uid";
  return { username, userId, text };
}

function injectDownloadButtons() {
  // 创建一个页面悬浮按钮：批量下载当前页面可见视频
  if (document.getElementById("vk-download-btn")) return;
  const btn = document.createElement("button");
  btn.id = "vk-download-btn";
  btn.textContent = "下载本页视频";
  Object.assign(btn.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    zIndex: 999999,
    padding: "10px 12px",
    background: "#1677ff",
    color: "#fff",
    borderRadius: "6px",
    border: "none",
    cursor: "pointer",
    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
  });
  btn.onclick = () => {
    const urls = findInstagramVideoUrls();
    const meta = getPageMeta();
    const items = urls.map((url) => ({
      url,
      filename: buildFilename(meta),
      username: meta.username,
      userId: meta.userId,
      text: meta.text,
    }));
    chrome.runtime.sendMessage(
      { type: "VK_DOWNLOAD_BATCH", payload: { items } },
      (res) => {
        // 可提示用户
        console.log("batch download response", res);
      },
    );
  };
  document.body.appendChild(btn);
}

function observeForVideos() {
  const ob = new MutationObserver(() => {
    injectDownloadButtons();
  });
  ob.observe(document.documentElement, { subtree: true, childList: true });
  injectDownloadButtons();
}

(() => {
  if (
    location.host.includes("instagram.com") ||
    location.host.includes("x.com")
  ) {
    observeForVideos();
  }
})();
