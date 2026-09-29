"use client";

import type { RefObject } from "react";
import { MinimalSplash } from "./splash";
import { StagedSplash } from "./splash-staged";
import type { SplashProgressOptions } from "./use-splash-progress";

export type SplashVariant = "minimal" | "map" | "network" | "cosmos";

export const SPLASH_VARIANTS: { id: SplashVariant; label: string }[] = [
  { id: "minimal", label: "极简" },
  { id: "map", label: "A 点阵地图" },
  { id: "network", label: "B 节点组网" },
  { id: "cosmos", label: "C 宇宙缩放" },
];

type SplashProps = SplashProgressOptions & {
  variant?: SplashVariant;
  /** Map variant: the element the hero's map sits in. */
  targetRef?: RefObject<HTMLElement | null>;
};

export function Splash({ variant = "minimal", targetRef, ...options }: SplashProps) {
  if (variant === "minimal") return <MinimalSplash {...options} />;
  return <StagedSplash targetRef={targetRef} variant={variant} {...options} />;
}
