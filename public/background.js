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

// 只在下载成功时添加记录
async function addSuccessRecord({
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
    createdAt: now,
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

// 用于存储待处理的下载信息（下载成功后才会持久化）
const pendingDownloads = new Map();

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

// 根据 URL 推断文件扩展名（确保下载的文件有正确的扩展名）
function ensureFileExtension(filename, url) {
  if (!filename || !url) return filename || "download";

  // 如果已经有扩展名，直接返回
  if (/\.\w{2,4}$/i.test(filename)) {
    return filename;
  }

  // 根据 URL 特征推断扩展名
  const urlStr = String(url);
  let ext = "";

  if (/\.mp4(\?|$|#)/i.test(urlStr) || urlStr.includes("video.twimg.com")) {
    ext = ".mp4";
  } else if (/\.jpg(\?|$|#)/i.test(urlStr) || /\.jpeg(\?|$|#)/i.test(urlStr)) {
    ext = ".jpg";
  } else if (/\.png(\?|$|#)/i.test(urlStr)) {
    ext = ".png";
  } else if (/\.gif(\?|$|#)/i.test(urlStr)) {
    ext = ".gif";
  } else if (/\.webp(\?|$|#)/i.test(urlStr)) {
    ext = ".webp";
  } else if (urlStr.includes("pbs.twimg.com/media/")) {
    // Twitter 图片默认 jpg
    ext = ".jpg";
  } else if (urlStr.includes("twimg.com")) {
    // 其他 twimg 资源默认视频
    ext = ".mp4";
  }

  return ext ? `${filename}${ext}` : filename;
}

const handlers = {
  async VK_CHECK_HISTORY(payload) {
    const { tweetId } = payload || {};
    if (!tweetId) throw new Error("empty tweetId");
    const record = await db.get(STORE_HISTORY, tweetId);
    return { isExist: !!record };
  },

  async VK_CHECK_HISTORY_BATCH(payload) {
    const ids = Array.isArray(payload?.tweetIds) ? payload.tweetIds : [];
    const existing = new Set();
    await withStore(STORE_HISTORY, "readonly", (store) => {
      ids.forEach((id) => {
        try {
          store.get(id).onsuccess = (e) => {
            if (e?.target?.result) existing.add(String(id));
          };
        } catch (_) {}
      });
    });
    return { existing: Array.from(existing) };
  },

  async VK_DOWNLOAD(payload) {
    const { url, filename, tweetId, screenName, text } = payload || {};
    if (!url) throw new Error("empty url");

    // 确保文件名有正确的扩展名
    const baseFilename = filename || `video-${Date.now()}.mp4`;
    const resolvedFilename = ensureFileExtension(baseFilename, url);

    let downloadId;
    try {
      downloadId = await triggerDownload({
        url,
        filename: resolvedFilename,
        saveAs: false,
        conflictAction: "uniquify",
      });
    } catch (e) {
      // 回退：移除子目录，仅保留文件名，避免某些系统路径不兼容
      const fallback = resolvedFilename.split("/").pop();
      downloadId = await triggerDownload({
        url,
        filename: fallback,
        saveAs: false,
        conflictAction: "uniquify",
      });
    }

    // 存储待处理信息，等待下载完成
    pendingDownloads.set(downloadId, {
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
          // 确保文件名有正确的扩展名
          const baseFilename = item.filename || `video-${Date.now()}.mp4`;
          const desired = ensureFileExtension(baseFilename, item.url);

          let downloadId;
          try {
            downloadId = await triggerDownload({
              url: item.url,
              filename: desired,
              saveAs: false,
              conflictAction: "uniquify",
            });
          } catch (e) {
            const fallback = desired.split("/").pop();
            downloadId = await triggerDownload({
              url: item.url,
              filename: fallback,
              saveAs: false,
              conflictAction: "uniquify",
            });
          }

          // 存储待处理信息，等待下载完成
          pendingDownloads.set(downloadId, {
            url: item.url,
            filename: desired,
            tweetId: item.tweetId,
            screenName: item.screenName,
            text: item.text,
            downloadId,
          });

          return { ...item, downloadId };
        } catch (error) {
          return { ...item, error: error.message };
        }
      }),
    );
    return { results };
  },
  async VK_SHOW_IN_FOLDER(payload) {
    const id = payload?.downloadId;
    if (typeof id !== "number") throw new Error("invalid downloadId");
    try {
      if (chrome?.downloads?.show) {
        chrome.downloads.show(id);
        return { ok: true };
      }
      throw new Error("downloads.show unavailable");
    } catch (error) {
      throw new Error(error?.message || "show in folder failed");
    }
  },
  async VK_LIST_DOWNLOADS(payload) {
    const page = Math.max(1, Number(payload?.page) || 1);
    const pageSize = Math.min(
      1000,
      Math.max(1, Number(payload?.pageSize) || 10),
    );
    const text = String(payload?.text || "").toLowerCase();
    const user = String(payload?.user || "").trim();
    const users = Array.isArray(payload?.users)
      ? payload.users.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const status = String(payload?.status || "").trim();

    const all = [];
    await withStore(STORE_RECORDS, "readonly", (store) => {
      const idx = store.index("createdAt");
      idx.openCursor(null, "prev").onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        all.push(cursor.value);
        cursor.continue();
      };
    });

    let list = all;
    if (users.length) {
      const set = new Set(users.map(String));
      list = list.filter(
        (r) => set.has(String(r.screenName)) || set.has(String(r.userId)),
      );
    } else if (user) {
      list = list.filter(
        (r) => r.screenName === user || String(r.userId) === user,
      );
    }
    if (status) {
      list = list.filter((r) => r.status === status);
    }
    if (text) {
      list = list.filter((r) =>
        [r.filename, r.screenName, r.userId, r.text, r.tweetId]
          .filter(Boolean)
          .some((x) => String(x).toLowerCase().includes(text)),
      );
    }

    const total = list.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const items = list.slice(start, end);
    return { items, total, page, pageSize };
  },
  async VK_LIST_USERS() {
    const seen = new Set();
    const users = [];
    await withStore(STORE_RECORDS, "readonly", (store) => {
      const idx = store.index("screenName");
      idx.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        const v = cursor.value || {};
        const key = v.screenName || v.userId;
        if (key && !seen.has(key)) {
          seen.add(key);
          users.push({
            screenName: v.screenName || String(key),
            userId: v.userId || "",
            username: v.username || "",
          });
        }
        cursor.continue();
      };
    });
    users.sort((a, b) =>
      String(a.screenName || "").localeCompare(String(b.screenName || "")),
    );
    return { users };
  },

  async VK_CLEAR_ALL_DATA() {
    // 清空所有下载记录
    await withStore(STORE_RECORDS, "readwrite", (store) => {
      store.clear();
    });
    // 清空下载历史
    await withStore(STORE_HISTORY, "readwrite", (store) => {
      store.clear();
    });
    return { cleared: true, count: "all" };
  },

  async VK_CLEAR_USER_DATA(payload) {
    const { users = [] } = payload || {};
    if (!users.length) throw new Error("No users specified");

    const userSet = new Set(users.map((u) => String(u).trim()).filter(Boolean));
    let deletedCount = 0;

    // 清空指定用户的下载记录
    await withStore(STORE_RECORDS, "readwrite", (store) => {
      store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        const v = cursor.value || {};
        const matchUser =
          userSet.has(String(v.screenName)) || userSet.has(String(v.userId));
        if (matchUser) {
          cursor.delete();
          deletedCount++;
        }
        cursor.continue();
      };
    });

    // 清空指定用户的下载历史
    await withStore(STORE_HISTORY, "readwrite", (store) => {
      store.openCursor().onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return;
        const v = cursor.value || {};
        const matchUser = userSet.has(String(v.screenName));
        if (matchUser) {
          cursor.delete();
        }
        cursor.continue();
      };
    });

    return { cleared: true, count: deletedCount, users: Array.from(userSet) };
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
  if (status !== "complete") return;

  const downloadId = delta.id;
  if (typeof downloadId === "number" && pendingDownloads.has(downloadId)) {
    const info = pendingDownloads.get(downloadId);
    // 只在下载成功时添加记录
    addSuccessRecord(info).catch(() => {});
    pendingDownloads.delete(downloadId);
  }

  chrome.runtime.sendMessage({ type: "VK_DOWNLOAD_STATE", payload: delta });
});
