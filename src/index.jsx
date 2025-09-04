import React from "react";
import ReactDOM from "react-dom/client";
import {
  RouterProvider,
  Router,
  createHashHistory,
} from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import "antd/dist/reset.css";

// 使用 Hash 路由，适配 chrome 扩展的 index.html 入口
const hashHistory = createHashHistory();
const router = new Router({ routeTree, history: hashHistory });

// 首次进入若无 hash，则跳转到根路由，避免 Not Found
if (!location.hash) {
  location.replace(`${location.pathname}#/`);
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<RouterProvider router={router} />);
