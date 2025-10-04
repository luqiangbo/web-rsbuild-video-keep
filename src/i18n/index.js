import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { getSettings, subscribeSettings } from "@/utils/settings";

import zhCN from "./locales/zh-CN.json";
import enUS from "./locales/en-US.json";
import jaJP from "./locales/ja-JP.json";

// 语言检测与持久化可按需添加：i18next-browser-languagedetector
// 这里默认中文，无回退到英文；若键缺失将返回 key，
// 如果某些键存在但值为空字符串，则按预期显示为空串。

void i18n.use(initReactI18next).init({
  lng: "zh-CN",
  fallbackLng: false,
  resources: {
    "zh-CN": { translation: zhCN || {} },
    "en-US": { translation: enUS || {} },
    "ja-JP": { translation: jaJP || {} },
  },
  interpolation: { escapeValue: false },
  returnEmptyString: true,
  keySeparator: false,
  nsSeparator: false,
  // 保持简单：按 key 取值；缺失键返回 key，后续完善本地化资源。
});

// 根据设置切换语言，并订阅设置变化
getSettings()
  .then((s) => {
    if (s?.lang) i18n.changeLanguage(s.lang);
  })
  .catch(() => {});

subscribeSettings((next) => {
  if (next?.lang) i18n.changeLanguage(next.lang);
});

export default i18n;
