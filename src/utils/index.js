// IndexedDB 工具：存储下载记录、去重与状态

const DB_NAME = "video_keep_db";
const DB_VERSION = 1;
const STORE_DOWNLOADS = "downloads";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOWNLOADS)) {
        const store = db.createObjectStore(STORE_DOWNLOADS, { keyPath: "id" });
        store.createIndex("by_url", "url", { unique: false });
        store.createIndex("by_user", ["username", "userId"], { unique: false });
        store.createIndex("by_createdAt", "createdAt", { unique: false });
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
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

export async function addDownloadRecord(record) {
  const id = record.id || crypto.randomUUID();
  const payload = {
    id,
    url: record.url,
    filename: record.filename,
    username: record.username,
    userId: record.userId,
    text: record.text || "",
    status: record.status || "queued",
    downloadId: record.downloadId || null,
    createdAt: record.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await withStore("readwrite", (store) => store.put(payload));
  return payload;
}

export async function bulkAddDownloadRecords(items) {
  const inserted = [];
  await withStore("readwrite", (store) => {
    items.forEach((it) => {
      const payload = {
        id: it.id || crypto.randomUUID(),
        url: it.url,
        filename: it.filename,
        username: it.username,
        userId: it.userId,
        text: it.text || "",
        status: it.status || "queued",
        downloadId: it.downloadId || null,
        createdAt: it.createdAt || Date.now(),
        updatedAt: Date.now(),
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
        val.status = "completed";
        val.updatedAt = Date.now();
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
