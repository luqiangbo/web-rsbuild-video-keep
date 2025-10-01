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
const STORE_HISTORY = "vk_history";
const STORE_RECORDS = "vk_records";

function openDb() {
  if (VK_IDB_DB) return Promise.resolve(VK_IDB_DB);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(VK_IDB_NAME, VK_IDB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      const tx = event.target.transaction;

      const historyStore = db.objectStoreNames.contains(STORE_HISTORY)
        ? tx.objectStore(STORE_HISTORY)
        : db.createObjectStore(STORE_HISTORY, { keyPath: "tweetId" });
      if (!historyStore.indexNames.contains("screenName")) {
        historyStore.createIndex("screenName", "screenName", { unique: false });
      }

      const recordStore = db.objectStoreNames.contains(STORE_RECORDS)
        ? tx.objectStore(STORE_RECORDS)
        : db.createObjectStore(STORE_RECORDS, {
            keyPath: "id",
            autoIncrement: true,
          });
      const indices = [
        ["downloadId", "downloadId"],
        ["tweetId", "tweetId"],
        ["createdAt", "createdAt"],
        ["screenName", "screenName"],
        ["url", "url"],
      ];
      indices.forEach(([name, key]) => {
        if (!recordStore.indexNames.contains(name)) {
          recordStore.createIndex(name, key, { unique: false });
        }
      });
    };
    req.onsuccess = () => {
      VK_IDB_DB = req.result;
      resolve(VK_IDB_DB);
    };
    req.onerror = () => reject(req.error);
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try {
      result = callback(store);
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      if (result && typeof result === "object" && "result" in result) {
        resolve(result.result);
      } else {
        resolve(result);
      }
    };
    tx.onerror = () => reject(tx.error);
  });
}

const db = {
  get(store, key) {
    return withStore(store, "readonly", (storeRef) => storeRef.get(key));
  },
  put(store, value) {
    return withStore(store, "readwrite", (storeRef) => storeRef.put(value));
  },
  getByIndex(store, index, key) {
    return withStore(store, "readonly", (storeRef) =>
      storeRef.index(index).get(key),
    );
  },
};

async function updateRecordStatus(downloadId, patch) {
  const record = await db.getByIndex(STORE_RECORDS, "downloadId", downloadId);
  if (!record) return;
  await db.put(STORE_RECORDS, { ...record, ...patch });
}

async function persistRecord({
  url,
  filename,
  tweetId,
  screenName,
  text,
  downloadId,
}) {
  const now = Date.now();
  const record = {
    downloadId,
    url,
    filename,
    tweetId: tweetId || null,
    screenName: screenName || null,
    text: text || null,
    status: downloadId ? "queued" : "interrupted",
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  await db.put(STORE_RECORDS, record).catch(() => {});

  if (tweetId) {
    await db
      .put(STORE_HISTORY, {
        tweetId,
        screenName: screenName || null,
        text: text || null,
        firstDownloadedAt: now,
        updatedAt: now,
      })
      .catch(() => {});
  }

  chrome.runtime.sendMessage({ type: "VK_DOWNLOAD_RECORD", payload: record });
  return record;
}

function triggerDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError || typeof downloadId !== "number") {
        reject(
          new Error(chrome.runtime.lastError?.message || "download failed"),
        );
      } else {
        resolve(downloadId);
      }
    });
  });
}

const handlers = {
  async VK_CHECK_HISTORY(payload) {
    const { tweetId } = payload || {};
    if (!tweetId) throw new Error("empty tweetId");
    const record = await db.get(STORE_HISTORY, tweetId);
    return { isExist: !!record };
  },

  async VK_DOWNLOAD(payload) {
    const { url, filename, tweetId, screenName, text } = payload || {};
    if (!url) throw new Error("empty url");
    const resolvedFilename = filename || `video-${Date.now()}.mp4`;
    const downloadId = await triggerDownload({
      url,
      filename: resolvedFilename,
      saveAs: false,
      conflictAction: "uniquify",
    });
    await persistRecord({
      url,
      filename: resolvedFilename,
      tweetId,
      screenName,
      text,
      downloadId,
    });
    return { downloadId };
  },

  async VK_DOWNLOAD_BATCH(payload) {
    const items = payload?.items || [];
    const results = await Promise.all(
      items.map(async (item) => {
        try {
          const downloadId = await triggerDownload({
            url: item.url,
            filename: item.filename || `video-${Date.now()}.mp4`,
            saveAs: false,
            conflictAction: "uniquify",
          });
          await persistRecord({ ...item, downloadId });
          return { ...item, downloadId, status: "queued" };
        } catch (error) {
          return { ...item, status: "interrupted", error: error.message };
        }
      }),
    );
    return { results };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return;
  handler(message.payload)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) =>
      sendResponse({ ok: false, error: error.message || String(error) }),
    );
  return true;
});

chrome.downloads.onChanged.addListener((delta) => {
  const status = delta.state?.current;
  if (!status || (status !== "complete" && status !== "interrupted")) return;
  chrome.runtime.sendMessage({ type: "VK_DOWNLOAD_STATE", payload: delta });
  if (typeof delta.id === "number") {
    updateRecordStatus(delta.id, {
      status,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    }).catch(() => {});
  }
});
