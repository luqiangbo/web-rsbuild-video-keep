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

export async function listDownloads(limit = 500) {
  const results = [];
  await withStore("readonly", (store) => {
    const idx = store.index("by_createdAt");
    idx.openCursor(null, "prev").onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value);
        cursor.continue();
      }
    };
  });
  return results;
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
