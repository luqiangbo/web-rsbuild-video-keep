/* global chrome */

// 侧边栏：点击扩展图标自动打开（依赖 manifest 中 side_panel.default_path）
try {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
} catch (_) {}

// 消息通道：content -> background -> 执行下载
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "VK_DOWNLOAD") {
    const { url, filename } = message.payload || {};
    if (!url) {
      sendResponse({ ok: false, error: "empty url" });
      return;
    }
    try {
      chrome.downloads.download(
        {
          url,
          filename: filename || `video-${Date.now()}.mp4`,
          saveAs: false,
          conflictAction: "uniquify",
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message,
            });
          } else {
            sendResponse({ ok: true, downloadId });
          }
        },
      );
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
    return true; // 异步响应
  }

  if (message.type === "VK_DOWNLOAD_BATCH") {
    const { items } = message.payload || { items: [] };
    const results = [];
    let remaining = items.length;
    if (remaining === 0) {
      sendResponse({ ok: true, results: [] });
      return true;
    }
    items.forEach((it) => {
      chrome.downloads.download(
        {
          url: it.url,
          filename: it.filename || `video-${Date.now()}.mp4`,
          saveAs: false,
          conflictAction: "uniquify",
        },
        (downloadId) => {
          const payload = {
            ...it,
            downloadId,
            status: downloadId ? "queued" : "interrupted",
          };
          results.push({
            ...payload,
            error: chrome.runtime.lastError?.message,
          });
          chrome.runtime.sendMessage({ type: "VK_DOWNLOAD_RECORD", payload });
          remaining -= 1;
          if (remaining === 0) {
            sendResponse({ ok: true, results });
          }
        },
      );
    });
    return true;
  }
});

// 监听下载状态更新
chrome.downloads.onChanged.addListener((delta) => {
  if (
    delta.state &&
    (delta.state.current === "complete" ||
      delta.state.current === "interrupted")
  ) {
    chrome.runtime.sendMessage({ type: "VK_DOWNLOAD_STATE", payload: delta });
  }
});
