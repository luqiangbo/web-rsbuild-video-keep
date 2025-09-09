/* global chrome, indexedDB */

(function () {
  const VK_IDB_NAME = "vk_downloads_db";
  const VK_IDB_VERSION = 1;
  const STORE_HISTORY = "vk_history";
  const STORE_RECORDS = "vk_records";

  let DB;

  function idbOpen() {
    if (DB) return Promise.resolve(DB);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(VK_IDB_NAME, VK_IDB_VERSION);
      req.onupgradeneeded = () => {
        // background.js 会负责建表，这里不重复
      };
      req.onsuccess = () => {
        DB = req.result;
        resolve(DB);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function idbAll(store) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const os = tx.objectStore(store);
      const req = os.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbClear(store) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.objectStore(store).clear();
    });
  }

  function groupBy(arr, keyFn) {
    const map = new Map();
    arr.forEach((it) => {
      const k = keyFn(it);
      const list = map.get(k) || [];
      list.push(it);
      map.set(k, list);
    });
    return map;
  }

  function formatDay(ts) {
    const d = new Date(ts);
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function render(list) {
    const root = document.getElementById("list");
    const empty = document.getElementById("empty");
    const summary = document.getElementById("summary");
    root.innerHTML = "";

    if (!list.length) {
      empty.style.display = "block";
      summary.textContent = "共 0 条";
      return;
    }
    empty.style.display = "none";

    summary.textContent = `共 ${list.length} 条`;

    // 按天分组
    const byDay = Array.from(
      groupBy(list, (r) =>
        formatDay(r.createdAt || r.firstDownloadedAt || Date.now()),
      ).entries(),
    ).sort((a, b) => (a[0] < b[0] ? 1 : -1));

    for (const [day, records] of byDay) {
      const sec = document.createElement("div");
      sec.className = "section";
      const h3 = document.createElement("h3");
      h3.textContent = day;
      sec.appendChild(h3);

      // 每天内按作者分组
      const byAuthor = Array.from(
        groupBy(records, (r) => r.screenName || "(未知作者)").entries(),
      ).sort((a, b) => a[0].localeCompare(b[0]));

      for (const [author, recs] of byAuthor) {
        const box = document.createElement("div");
        box.className = "author";
        const h4 = document.createElement("h4");
        h4.textContent = `${author} · ${recs.length} 条`;
        box.appendChild(h4);

        const ul = document.createElement("ul");
        ul.className = "records";
        recs
          .slice()
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .forEach((r) => {
            const li = document.createElement("li");
            const line1 = document.createElement("div");
            line1.className = "line";
            const name = document.createElement("div");
            name.className = "filename";
            name.textContent = r.filename || r.url || "(无文件名)";
            const st = document.createElement("div");
            st.className = "status";
            st.textContent = r.status || "-";
            line1.appendChild(name);
            line1.appendChild(st);

            const line2 = document.createElement("div");
            line2.className = "line muted";
            const a = document.createElement("div");
            a.textContent = `推文: ${r.tweetId || "-"}`;
            const b = document.createElement("div");
            const t = r.createdAt || r.firstDownloadedAt;
            b.textContent = t ? new Date(t).toLocaleString() : "";
            line2.appendChild(a);
            line2.appendChild(b);

            const line3 = document.createElement("div");
            line3.className = "muted";
            line3.textContent = (r.text || "").slice(0, 100);

            li.appendChild(line1);
            li.appendChild(line2);
            if (r.text) li.appendChild(line3);
            ul.appendChild(li);
          });
        box.appendChild(ul);
        sec.appendChild(box);
      }

      root.appendChild(sec);
    }
  }

  function applySearch(records, q) {
    const s = (q || "").trim().toLowerCase();
    if (!s) return records;
    return records.filter((r) => {
      return (
        (r.filename && r.filename.toLowerCase().includes(s)) ||
        (r.screenName && r.screenName.toLowerCase().includes(s)) ||
        (r.text && r.text.toLowerCase().includes(s)) ||
        (r.tweetId && String(r.tweetId).includes(s))
      );
    });
  }

  async function loadAndRender() {
    const [records, history] = await Promise.all([
      idbAll(STORE_RECORDS),
      idbAll(STORE_HISTORY),
    ]);
    // 只展示 records；history 用于去重/统计可扩展
    const q = document.getElementById("q").value;
    const list = applySearch(records, q);
    render(list);
  }

  function bindUI() {
    document.getElementById("refresh").addEventListener("click", loadAndRender);
    document.getElementById("q").addEventListener("input", loadAndRender);
    document.getElementById("clear").addEventListener("click", async () => {
      await idbClear(STORE_RECORDS);
      await idbClear(STORE_HISTORY);
      loadAndRender();
    });
  }

  function bindRuntimeEvents() {
    try {
      chrome.runtime.onMessage.addListener((msg) => {
        if (!msg || !msg.type) return;
        if (
          msg.type === "VK_DOWNLOAD_RECORD" ||
          msg.type === "VK_DOWNLOAD_STATE"
        ) {
          // 延迟以等待后台落库
          setTimeout(loadAndRender, 150);
        }
      });
    } catch (_) {}
  }

  bindUI();
  bindRuntimeEvents();
  loadAndRender();
})();
