"use client";

import { useEffect, useMemo, type RefObject } from "react";
import { Splash } from "@/components/splash";
import { setSplashState, useSplashState } from "@/lib/splash-state";
import { createSplashTasks } from "@/lib/splash-tasks";

// The opening splash of the home page: black dots gather into the hero's world map and hand
// over to it (variant "map"). It shows once per session, on the first load at "/"; the layout's
// inline script decides (lib/splash-state.ts).

// The hero marks where its map sits (home-relay.tsx); the dots land exactly there. Looked up each
// frame, since the hero swaps layouts across the 921px breakpoint. Without it (narrow screens,
// where the hero crops a larger map) the splash centres its own.
const target: RefObject<HTMLElement | null> = {
  get current() {
    return document.querySelector<HTMLElement>("[data-splash-target]");
  },
};

export function HomeSplash() {
  const state = useSplashState();
  const tasks = useMemo(() => createSplashTasks(), []);

  useEffect(() => {
    if (state === "on") setSplashState("running"); // the splash is up: drop the cover
  }, [state]);

  if (state === "off" || state === "done") return null;
  return (
    <Splash
      onDone={() => setSplashState("done")}
      onPhase={(phase) => {
        if (phase === "exit") setSplashState("handoff");
      }}
      targetRef={target}
      tasks={tasks}
      variant="map"
    />
  );
}
