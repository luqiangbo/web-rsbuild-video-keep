import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, Router } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// 创建路由实例
const router = new RouterProvider({
  router: new Router({ routeTree }),
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<div>{router}</div>);
