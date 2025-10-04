import React from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import i18n from "./i18n";
import ReactDOM from "react-dom/client";
import {
  RouterProvider,
  Router,
  createHashHistory,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "antd/dist/reset.css";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import jaJP from "antd/locale/ja_JP";

// 使用 Hash 路由，适配 chrome 扩展的 index.html 入口
const hashHistory = createHashHistory();
const router = new Router({ routeTree, history: hashHistory });

// 首次进入若无 hash，则跳转到根路由，避免 Not Found
if (!location.hash) {
  location.replace(`${location.pathname}#/`);
}

const root = ReactDOM.createRoot(document.getElementById("root"));
const antdLocales = { "zh-CN": zhCN, "en-US": enUS, "ja-JP": jaJP };

function App() {
  const { i18n: i18next } = useTranslation();
  const locale = antdLocales[i18next.language] || zhCN;
  return (
    <ConfigProvider locale={locale}>
      <RouterProvider router={router} />
    </ConfigProvider>
  );
}

root.render(
  <I18nextProvider i18n={i18n}>
    <App />
  </I18nextProvider>,
);
