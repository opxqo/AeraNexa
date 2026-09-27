import type { Metadata } from "next";
import { WorldMapDemo } from "@/components/world-map-demo";

export const metadata: Metadata = {
  title: "球冠半球地图 Demo",
  description: "AeraNexa 球冠式半球点阵地图，世界地图贴合球面顶部切片的透视效果",
};

export default function CapWorldMapDemoPage() {
  return <WorldMapDemo variant="cap" />;
}
