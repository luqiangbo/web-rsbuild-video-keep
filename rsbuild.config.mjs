import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginSvgr } from "@rsbuild/plugin-svgr";
import { pluginSass } from "@rsbuild/plugin-sass";
import { TanStackRouterRspack } from "@tanstack/router-plugin/rspack";

export default defineConfig({
  plugins: [pluginReact(), pluginSvgr(), pluginSass()],
  server: {
    port: 3007,
  },
  resolve: {
    alias: {
      "@": "./src",
    },
  },
  html: {
    template: "./static/index.html",
  },
  tools: {
    rspack: {
      plugins: [
        TanStackRouterRspack({
          target: "react",
          autoCodeSplitting: true,
          disableTypes: true,
          generatedRouteTree: "./src/routeTree.gen.js",
        }),
      ],
    },
  },
});
