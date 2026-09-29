import type { Metadata } from "next";
import { SplashDemo } from "@/components/splash/splash-demo";
import type { SplashVariant } from "@/components/splash";

export const metadata: Metadata = {
  title: "开屏加载 Demo",
  description: "AeraNexa 开屏加载动画演示：极简、点阵地图、节点组网、宇宙缩放四种。",
};

const VARIANTS: SplashVariant[] = ["minimal", "map", "network", "cosmos"];

// `?v=map|network|cosmos|minimal` picks the variant; `?p=0.5` starts in scrub mode at that progress.
export default async function SplashDemoPage({ searchParams }: { searchParams: Promise<{ v?: string; p?: string; diff?: string }> }) {
  const { v, p, diff } = await searchParams;
  const variant = VARIANTS.find((id) => id === v) ?? "minimal";
  const scrub = p !== undefined && Number.isFinite(Number(p)) ? Math.min(1, Math.max(0, Number(p))) : null;
  return <SplashDemo autoCompare={diff === "1"} initialScrub={scrub} initialVariant={variant} />;
}
