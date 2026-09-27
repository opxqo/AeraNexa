import type { Metadata } from "next";
import { WorldMapDemo } from "@/components/world-map-demo";

export const metadata: Metadata = {
  title: "3D 点阵地球 Demo",
  description: "AeraNexa 三维旋转陆地点阵地球独立演示",
};

export default function WorldGlobeDemoPage() {
  return <WorldMapDemo variant="globe" />;
}
