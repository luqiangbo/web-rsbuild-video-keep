import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSetState } from "ahooks";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

function RouteComponent() {
  const [state, setState] = useSetState({
    publicKey: "",
  });

  useEffect(() => {
    init();
  }, []);
  const init = () => {};
  return (
    <div>
      <div>video-keep</div>
    </div>
  );
}
