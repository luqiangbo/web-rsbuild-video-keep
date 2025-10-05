// IndexedDB 工具：存储下载记录、去重与状态

const DB_NAME = "video_keep_db";
const DB_VERSION = 2;
const STORE_DOWNLOADS = "records";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      const tx = ev.target.transaction;
      let store;
      if (!db.objectStoreNames.contains(STORE_DOWNLOADS)) {
        store = db.createObjectStore(STORE_DOWNLOADS, {
          keyPath: "id",
          autoIncrement: true,
        });
      } else {
        store = tx.objectStore(STORE_DOWNLOADS);
      }
      if (store) {
        const ensureIndex = (name, keyPath) => {
          if (!store.indexNames.contains(name)) {
            store.createIndex(name, keyPath, { unique: false });
          }
        };
        ensureIndex("by_downloadId", "downloadId");
        ensureIndex("by_tweetId", "tweetId");
        ensureIndex("by_createdAt", "createdAt");
        ensureIndex("by_url", "url");
        ensureIndex("by_screenName", "screenName");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DOWNLOADS, mode);
    const store = tx.objectStore(STORE_DOWNLOADS);
    let out;
    try {
      out = fn(store);
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

function sanitizeFilename(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .slice(0, 60);
}

function generateRandomString(len = 6) {
  const chars = "ABCDEFGHJKMNPQRSTWXYZ2345678";
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export async function addDownloadRecord(record) {
  const now = Date.now();
  const id = record.id ?? record.downloadId ?? crypto.randomUUID();
  const payload = {
    id,
    url: record.url,
    filename: record.filename,
    screenName: record.screenName || record.username || null,
    userId: record.userId || null,
    text: record.text || "",
    status: record.status || "queued",
    downloadId: record.downloadId || null,
    tweetId: record.tweetId || null,
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
    completedAt: record.completedAt || null,
  };
  await withStore("readwrite", (store) => store.put(payload));
  return payload;
}

export async function bulkAddDownloadRecords(items) {
  const inserted = [];
  await withStore("readwrite", (store) => {
    items.forEach((it) => {
      const now = Date.now();
      const payload = {
        id: it.id ?? it.downloadId ?? crypto.randomUUID(),
        url: it.url,
        filename: it.filename,
        screenName: it.screenName || it.username || null,
        userId: it.userId || null,
        text: it.text || "",
        status: it.status || "queued",
        downloadId: it.downloadId || null,
        tweetId: it.tweetId || null,
        createdAt: it.createdAt || now,
        updatedAt: it.updatedAt || now,
        completedAt: it.completedAt || null,
      };
      store.put(payload);
      inserted.push(payload);
    });
  });
  return inserted;
}

// Deprecated: prefer queryDownloads from background (SSOT)
export async function listDownloads(limit = 500) {
  const { items } = await queryDownloads({ page: 1, pageSize: limit });
  return items;
}

export async function queryDownloads({
  page = 1,
  pageSize = 10,
  text = "",
  user = "",
  users = [],
  status = "",
} = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime?.sendMessage(
        {
          type: "VK_LIST_DOWNLOADS",
          payload: { page, pageSize, text, user, users, status },
        },
        (res) => {
          if (!res || !res.ok) {
            resolve({ items: [], total: 0, page, pageSize });
            return;
          }
          resolve({ ...res.payload });
        },
      );
    } catch (_) {
      resolve({ items: [], total: 0, page, pageSize });
    }
  });
}

export async function listUsers() {
  return new Promise((resolve) => {
    try {
      chrome.runtime?.sendMessage(
        { type: "VK_LIST_USERS", payload: {} },
        (res) => {
          if (!res || !res.ok) {
            resolve([]);
            return;
          }
          resolve(res.payload?.users || []);
        },
      );
    } catch (_) {
      resolve([]);
    }
  });
}

export async function markDownloadedByDownloadId(downloadId) {
  await withStore("readwrite", (store) => {
    store.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return;
      const val = cursor.value;
      if (val.downloadId === downloadId) {
        const now = Date.now();
        val.status = "completed";
        val.updatedAt = now;
        val.completedAt = val.completedAt || now;
        cursor.update(val);
      }
      cursor.continue();
    };
  });
}

export async function hasDownloaded(url) {
  let exist = false;
  await withStore("readonly", (store) => {
    const idx = store.index("by_url");
    const req = idx.get(url);
    req.onsuccess = () => {
      exist = !!req.result;
    };
  });
  return exist;
}

// 清空所有数据
export async function clearAllData() {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime?.sendMessage(
        { type: "VK_CLEAR_ALL_DATA", payload: {} },
        (res) => {
          if (!res || !res.ok) {
            reject(new Error(res?.error || "Clear data failed"));
            return;
          }
          resolve(res.payload);
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

// 清空指定用户的数据
export async function clearUserData(users) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime?.sendMessage(
        { type: "VK_CLEAR_USER_DATA", payload: { users } },
        (res) => {
          if (!res || !res.ok) {
            reject(new Error(res?.error || "Clear user data failed"));
            return;
          }
          resolve(res.payload);
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}
