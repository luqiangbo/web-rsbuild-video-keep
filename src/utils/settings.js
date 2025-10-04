const SETTINGS_KEY = "video_keep_settings";
const LEGACY_DEFAULT_TEMPLATE = "{screenName}_{userId}_{tweetTime}_{random}";
const DEFAULT_SETTINGS = Object.freeze({
  filenameTemplate: "{screenName}_{username}_{tweetTime}",
  lang: "zh-CN",
  starredUsers: [],
});

function getChromeStorage() {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    return chrome.storage.local;
  }
  return null;
}

let cache = null;

function migrateLegacyTemplate(settings) {
  if (!settings) return { ...DEFAULT_SETTINGS };
  if (settings.filenameTemplate === LEGACY_DEFAULT_TEMPLATE) {
    return { ...settings, filenameTemplate: DEFAULT_SETTINGS.filenameTemplate };
  }
  return settings;
}

function readFromLocalStorage() {
  try {
    const cached = localStorage.getItem(SETTINGS_KEY);
    if (!cached) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(cached);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeToLocalStorage(next) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("saveSettings fallback failed", error);
  }
}

export async function getSettings() {
  if (cache) {
    return { ...cache };
  }
  const storage = getChromeStorage();
  if (!storage) {
    cache = migrateLegacyTemplate(readFromLocalStorage());
    return { ...cache };
  }
  return new Promise((resolve) => {
    storage.get([SETTINGS_KEY], (result) => {
      if (chrome.runtime?.lastError) {
        console.warn("getSettings error", chrome.runtime.lastError);
        cache = migrateLegacyTemplate(readFromLocalStorage());
        resolve({ ...cache });
        return;
      }
      const value = result?.[SETTINGS_KEY];
      if (!value) {
        cache = { ...DEFAULT_SETTINGS };
      } else {
        cache = migrateLegacyTemplate({ ...DEFAULT_SETTINGS, ...value });
      }
      resolve({ ...cache });
    });
  });
}

export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  cache = next;
  const storage = getChromeStorage();
  if (!storage) {
    writeToLocalStorage(next);
    return next;
  }
  return new Promise((resolve) => {
    storage.set({ [SETTINGS_KEY]: next }, () => {
      if (chrome.runtime?.lastError) {
        console.warn("setSettings error", chrome.runtime.lastError);
        writeToLocalStorage(next);
      }
      resolve(next);
    });
  });
}

export function subscribeSettings(callback) {
  const storage = getChromeStorage();
  if (!storage || !chrome.storage?.onChanged) return () => {};
  const handler = (changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes?.[SETTINGS_KEY];
    if (!change) return;
    const next = { ...DEFAULT_SETTINGS, ...(change.newValue || {}) };
    cache = next;
    callback(next);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => {
    try {
      chrome.storage.onChanged.removeListener(handler);
    } catch (_) {}
  };
}

export { DEFAULT_SETTINGS, SETTINGS_KEY };
