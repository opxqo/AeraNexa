import type { Metadata } from "next";
import { WorldMapDemo } from "@/components/world-map-demo";

export const metadata: Metadata = {
  title: "横版拱形地图 Demo",
  description: "AeraNexa 亚洲居中的横版拱形陆地点阵预览",
};

export default function ArchWorldMapDemoPage() {
  return <WorldMapDemo variant="arch" />;
}
