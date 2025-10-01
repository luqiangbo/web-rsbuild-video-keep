/* global chrome */

// 侧边栏：点击扩展图标自动打开（依赖 manifest 中 side_panel.default_path）
try {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
} catch (_) {}

// ==== IndexedDB helpers: vk_history & vk_records ====
let VK_IDB_DB;
const VK_IDB_NAME = "vk_downloads_db";
const VK_IDB_VERSION = 2;
const STORE_HISTORY = "vk_history"; // key: tweetId
const STORE_RECORDS = "vk_records"; // key: id (auto), index: downloadId, tweetId

function idbOpen() {
  if (VK_IDB_DB) return Promise.resolve(VK_IDB_DB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VK_IDB_NAME, VK_IDB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      const tx = ev.target.transaction;
      let historyStore;
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        historyStore = db.createObjectStore(STORE_HISTORY, {
          keyPath: "tweetId",
        });
      } else {
        historyStore = tx.objectStore(STORE_HISTORY);
      }
      if (historyStore && !historyStore.indexNames.contains("screenName")) {
        historyStore.createIndex("screenName", "screenName", { unique: false });
      }

      let recordStore;
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        recordStore = db.createObjectStore(STORE_RECORDS, {
          keyPath: "id",
          autoIncrement: true,
        });
      } else {
        recordStore = tx.objectStore(STORE_RECORDS);
      }
      if (recordStore) {
        if (!recordStore.indexNames.contains("downloadId")) {
          recordStore.createIndex("downloadId", "downloadId", {
            unique: false,
          });
        }
        if (!recordStore.indexNames.contains("tweetId")) {
          recordStore.createIndex("tweetId", "tweetId", { unique: false });
        }
        if (!recordStore.indexNames.contains("createdAt")) {
          recordStore.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!recordStore.indexNames.contains("screenName")) {
          recordStore.createIndex("screenName", "screenName", {
            unique: false,
          });
        }
        if (!recordStore.indexNames.contains("url")) {
          recordStore.createIndex("url", "url", { unique: false });
        }
      }
    };
    req.onsuccess = () => {
      VK_IDB_DB = req.result;
      resolve(VK_IDB_DB);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(store).put(value);
  });
}

async function idbGet(store, key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetByIndex(store, index, key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    tx.onerror = () => reject(tx.error);
    const req = tx.objectStore(store).index(index).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbUpdateRecordByDownloadId(downloadId, patch) {
  const rec = await idbGetByIndex(STORE_RECORDS, "downloadId", downloadId);
  if (!rec) return false;
  const next = { ...rec, ...patch };
  await idbPut(STORE_RECORDS, next);
  return true;
}

// 消息通道：content -> background -> 执行下载
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "VK_CHECK_HISTORY") {
    const { tweetId } = message.payload || {};
    if (!tweetId) {
      sendResponse({ ok: false, error: "empty tweetId" });
      return true;
    }
    idbGet(STORE_HISTORY, tweetId)
      .then((val) => {
        sendResponse({ ok: true, payload: { isExist: !!val } });
      })
      .catch((e) =>
        sendResponse({ ok: false, error: e?.message || String(e) }),
      );
    return true;
  }

  if (message.type === "VK_DOWNLOAD") {
    const { url, filename, tweetId, screenName, text } = message.payload || {};
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
            try {
              // persist record and history
              const now = Date.now();
              const createdAt = now;
              const record = {
                downloadId,
                url,
                filename: filename || `video-${Date.now()}.mp4`,
                tweetId: tweetId || null,
                screenName: screenName || null,
                text: text || null,
                status: downloadId ? "queued" : "interrupted",
                createdAt,
                updatedAt: now,
                completedAt: null,
              };
              idbPut(STORE_RECORDS, record).catch(() => {});
              if (tweetId) {
                idbPut(STORE_HISTORY, {
                  tweetId,
                  screenName: screenName || null,
                  text: text || null,
                  firstDownloadedAt: createdAt,
                  updatedAt: now,
                }).catch(() => {});
              }
              chrome.runtime.sendMessage({
                type: "VK_DOWNLOAD_RECORD",
                payload: record,
              });
            } catch (_) {}
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
          const now = Date.now();
          const payload = {
            ...it,
            downloadId,
            status: downloadId ? "queued" : "interrupted",
            createdAt: it.createdAt || now,
            updatedAt: now,
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
    try {
      const status = delta.state.current;
      const completedAt = Date.now();
      if (typeof delta.id === "number") {
        idbUpdateRecordByDownloadId(delta.id, { status, completedAt }).catch(
          () => {},
        );
      }
    } catch (_) {}
  }
});
