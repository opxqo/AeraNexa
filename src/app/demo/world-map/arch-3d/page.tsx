import type { Metadata } from "next";
import { WorldMapDemo } from "@/components/world-map-demo";

export const metadata: Metadata = {
  title: "3D 点阵地球-横版拱形平面图 Demo",
  description: "AeraNexa 横版拱形陆地点阵预览，陆地数据取自 3D 点阵地球数据源",
};

export default function WorldMapArch3dPage() {
  return <WorldMapDemo variant="arch3d" />;
}
