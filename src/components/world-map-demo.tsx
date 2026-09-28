import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WorldGlobeDemo } from "@/components/world-globe-demo";
import { WorldMapArchCityLayer } from "@/components/world-map-arch-city-layer";
import { WorldMapCapScrollDemo } from "@/components/world-map-cap-scroll-demo";
import { WorldMapCityLayer } from "@/components/world-map-city-layer";
import styles from "@/app/demo/world-map/world-map-demo.module.css";

type Variant = "flat" | "arch" | "globe" | "arch3d" | "cap";

const copy: Record<Variant, { title: string; navLabel: string; description: string; label: string }> = {
  flat: { title: "全球陆地点阵", navLabel: "完整平面图", description: "完整平面地图 · 亚洲居中", label: "完整世界地图点阵预览" },
  arch: { title: "横版拱形地图", navLabel: "横版拱形图", description: "横向展示 · 亚洲居中 · 城市位置与延迟为演示数据", label: "横版拱形世界地图点阵与北京、广州至海外城市的脉冲连接路线" },
  globe: { title: "3D 点阵地球", navLabel: "3D 点阵地球", description: "可拖动旋转 · 亚洲居中 · 城市位置与延迟为演示数据", label: "三维世界陆地点阵地球与北京、广州至海外城市的连接路线" },
  arch3d: { title: "3D 点阵地球-横版拱形平面图", navLabel: "3D 拱形地球", description: "横向展示 · 亚洲居中 · 陆地点阵取自 3D 点阵地球数据源", label: "横版拱形世界地图点阵（取自 3D 点阵地球数据源）与北京、广州至海外城市的脉冲连接路线" },
  cap: { title: "球冠半球地图", navLabel: "球冠地图", description: "世界地图贴合球面顶部切片 · 透视弧面 · 城市位置与延迟为演示数据", label: "球冠式半球世界点阵地图与北京、广州至海外城市的连接路线" },
};

const variantOrder: Variant[] = ["flat", "arch", "globe", "arch3d", "cap"];
const variantHref: Record<Variant, string> = {
  flat: "/demo/world-map",
  arch: "/demo/world-map/arch",
  globe: "/demo/world-map/globe",
  arch3d: "/demo/world-map/arch-3d",
  cap: "/demo/world-map/cap",
};

// Image asset base path for each flat/arch variant; "arch" and "arch3d"
// share the same layout and only swap which land-dot source they draw.
const imageBase: Partial<Record<Variant, string>> = {
  flat: "/demo/world-map",
  arch: "/demo/world-map-arch",
  arch3d: "/demo/world-map-arch-globe",
};

export function WorldMapDemo({ variant = "flat" }: { variant?: Variant }) {
  const isArchLayout = variant === "arch" || variant === "arch3d";
  const viewHeight = isArchLayout ? 560 : 800;
  const current = (target: Variant) => (variant === target ? "page" : undefined);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link className={styles.back} href="/"><ArrowLeft size={16} /> 返回首页</Link>
          <p className={styles.kicker}>AERANEXA · MAP STUDY</p>
          <h1>{copy[variant].title}</h1>
          <p className={styles.description}>{copy[variant].description}</p>
          <nav className={styles.variants} aria-label="地图版本">
            {variantOrder.map((target) => (
              <Link key={target} href={variantHref[target]} aria-current={current(target)}>{copy[target].navLabel}</Link>
            ))}
          </nav>
        </header>

        {variant === "cap" ? (
          <WorldMapCapScrollDemo label={copy[variant].label} />
        ) : (
        <section className={styles.stage} aria-label={copy[variant].label}>
          {variant === "globe" ? (
            <WorldGlobeDemo />
          ) : (
            <div className={styles.mapFrame}>
              <svg
                className={`${styles.map} ${isArchLayout ? styles.archMap : ""}`}
                viewBox={`0 0 1600 ${viewHeight}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={isArchLayout ? "横版拱形世界陆地点阵，亚洲居中，不含南北极" : "完整世界陆地点阵，亚洲居中，包括南极洲"}
              >
                <image className={styles.desktopDots} href={`${imageBase[variant]}-desktop.svg`} width="1600" height={viewHeight} />
                <image className={styles.mobileDots} href={`${imageBase[variant]}-mobile.svg`} width="1600" height={viewHeight} />
              </svg>
              {variant === "arch" && <WorldMapCityLayer />}
              {variant === "arch3d" && <WorldMapArchCityLayer />}
            </div>
          )}
        </section>
        )}
      </div>
    </main>
  );
}
