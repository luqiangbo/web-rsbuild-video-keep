import * as React from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";

import "@/styles/index.scss";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <React.Fragment>
      <Outlet />
    </React.Fragment>
  );
}
