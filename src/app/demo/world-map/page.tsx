import type { Metadata } from "next";
import { WorldMapDemo } from "@/components/world-map-demo";

export const metadata: Metadata = {
  title: "世界陆地点阵 Demo",
  description: "AeraNexa 完整世界陆地点阵的独立视觉预览",
};

export default function WorldMapDemoPage() {
  return <WorldMapDemo />;
}
