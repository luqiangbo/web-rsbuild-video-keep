import * as React from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";

import "@/styles/index.scss";
import { addDownloadRecord, markDownloadedByDownloadId } from "@/utils";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  React.useEffect(() => {
    // 后台推送的记录
    const handler = (msg) => {
      if (!msg || !msg.type) return;
      if (msg.type === "VK_DOWNLOAD_RECORD") {
        addDownloadRecord(msg.payload);
      }
      if (msg.type === "VK_DOWNLOAD_STATE") {
        const id = msg.payload?.id;
        const state = msg.payload?.state?.current;
        if (id && state === "complete") {
          markDownloadedByDownloadId(id);
        }
      }
    };
    chrome.runtime?.onMessage?.addListener?.(handler);
    return () => chrome.runtime?.onMessage?.removeListener?.(handler);
  }, []);
  return (
    <React.Fragment>
      <Outlet />
    </React.Fragment>
  );
}
