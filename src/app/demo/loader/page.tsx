import type { Metadata } from "next";
import { BrandLoaderDemo } from "@/components/brand-loader-demo";

export const metadata: Metadata = {
  title: "BrandLoader Demo",
  description: "AeraNexa 品牌加载组件：数据包在 Logo 的中继节点之间逐跳传递。",
};

// `?at=0.26` parks the animation at that point (in laps: 0–1 the first, 1–2 the second), to inspect a single frame.
export default async function LoaderDemoPage({ searchParams }: { searchParams: Promise<{ at?: string }> }) {
  const { at } = await searchParams;
  const value = at !== undefined && Number.isFinite(Number(at)) ? Math.min(2, Math.max(0, Number(at))) : null;
  return <BrandLoaderDemo initialAt={value} />;
}
