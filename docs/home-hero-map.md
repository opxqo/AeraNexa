# 首页 Hero 球冠地图：开发总结

> 截至 2026-09-28，分支 `3x-node-an-panel`，最新提交 `e64aa39`。Hero 开发暂告一段落，本文供下次接手时快速上手。

## 1. 现状一览

首页 Hero 由三部分组成：
- **顶部导航**：参照 intercom.com 的实测参数，基于 Base UI NavigationMenu；
- **标题区**：标题、副标题和两个按钮，中英双语；
- **球冠地图**：一张倾斜球面上的世界点阵地图，每 60 秒自转一圈。
  - 中国整体标成橙色，中部有一个"枢纽"大圆点；
  - 枢纽每 1.6 秒向 10 个海外城市之一发射一颗彗星，彗星落地后产生冲击波。

演示页 `/demo/world-map/cap` 使用同一个地图组件，另外多一个效果：往下滚动时，球冠会逐渐卷成一个完整的地球。

## 2. 文件地图

| 文件 | 作用 |
|---|---|
| `src/app/page.tsx` | 首页；从 cookie `aeranexa_locale` 读取语言，生成 metadata |
| `src/app/home-locale-action.ts` | Server Action，负责写入语言 cookie |
| `src/lib/home-copy.ts` | 首页中英文案，两种语言共用同一个类型，缺少任何 key 都会被类型检查报出来 |
| `src/components/home-hero.tsx` | Hero 的整体结构 |
| `src/components/home-header.tsx` | 导航栏（下拉面板、语言切换、手机端菜单） |
| `src/app/home-hero.module.css` | 首页全部样式：网格背景、导航、地图视口的遮罩和位置 |
| `src/components/world-map-cap.tsx` | **地图组件**：Canvas 绘制点阵、自转动画、静态 SVG 首帧、卷曲入口 `curlRef` |
| `src/components/world-map-cap-city-layer.tsx` | 城市标记和标签、发射调度、彗星与冲击波画布 |
| `src/lib/demo/cap-projection.ts` | **投影**：经纬度 → 球面角 → 屏幕坐标，以及卷曲参数 |
| `src/lib/demo/cap-dots.ts` | **陆地点阵**：解码预生成的点，每帧做投影 |
| `src/lib/demo/cap-comet.ts` | 彗星 `COMET` 和冲击波 `SHOCKWAVE` 的绘制与参数 |
| `src/lib/demo/cap-cities.ts` | 中国枢纽、10 个海外城市、发射顺序 |
| `src/components/world-map-cap-scroll-demo.tsx` | 演示页专用：滚动轨道加 sticky 舞台，负责驱动卷曲 |
| `scripts/generate-demo-cap-map.py` | **生成脚本**：点阵、海岸线、中国范围、静态 SVG |
| `scripts/data/land-110m.json`、`countries-110m.json` | Natural Earth 1:110m 的陆地和国家数据 |
| `public/demo/world-cap-land.json` | 生成产物：前端运行时用的点数据 |
| `public/demo/world-map-cap-{desktop,mobile}.svg` | 生成产物：Canvas 接管之前显示的静态首帧 |

## 3. 投影（`cap-projection.ts`）

地图的原理是：把世界地图贴到一个倾斜的球面上，然后透视放大，只看球冠顶部的一部分。

- **经纬度 → 球面角**：
  - `θ = (经度 − 接缝) × 0.28`：360° 经度只占球面约 ±50°；
  - `φ = (纬度 − 12) × 0.18`。
- **倾角和镜头**：倾角 33°，镜头距离 2.75。取景方式是：接缝附近两条经线正好贴住画面左右两边，北纬 84° 的顶沿位于 y = 40。
- **画面尺寸**：1600 × 640 视图单位。
- **自转**：自转就是让接缝经度 `seam` 随时间变化（`DEGREES_PER_SECOND`）。所有投影函数都接收 `seam` 参数。
- **Python 镜像**：这些常量在 `generate-demo-cap-map.py` 里有一份镜像，**两边必须同步修改**，否则静态首帧会和 Canvas 对不上。
- **卷曲**：`curl` 从 0 到 1 时，上面所有参数会从"球冠值"插值到"完整球值"（见第 9 节）。curl 是模块级状态，一页上所有地图共用；每张 `WorldMapCap` 在每次绘制前都会先 `setCapCurl(自己的 curl)`，城市图层也在同一次同步绘制里更新，所以一页可以放多张地图（首页手机端就同时有平面 Hero 和独立的地球）。

## 4. 陆地点阵（重点）

### 4.1 现在的做法：点固定在球面上，跟着地图转（提交 `e64aa39`）

每个点都固定在某个经纬度上，所以地图转动时，点跟着大陆一起平移。

**离线部分**：`generate-demo-cap-map.py` 一次算好所有点，桌面和手机各一套参数。
1. **陆地点阵**：按经纬度排成交错点阵。
   - 行按纬度等距排列，列按经度等距排列，相邻行错开半格；
   - 每行的列数取整，让 360° 正好整除，所以绕过日期变更线时没有接缝。
   - **步长如何确定**：在 `REFERENCE_LATITUDE`（北纬 40°）的位置，相邻两点投影到屏幕上的距离正好等于列距 6、行距 5.2（手机为 14 和 12）。
   - 格点落在陆地上（用多边形精确判断），并且离海岸线点、国界点大于 `clearance`，才保留。
2. **海岸线、国界、十段线**：沿线按固定弧长取点，间距为 2.6（手机 6）。弧长的度量方式和上面的步长换算一致。岛屿各取一个点。
3. **中国分类**：按中国掩码把点分到"中国"和"其他"两组。海岸点判断时向外扩一格掩码。
4. **写入 `world-cap-land.json`**：格式为 `{ desktop, mobile }`，每套包含：
   - `rows` / `cols`：点阵行列数；
   - `land` / `china`：点阵位图，每个格点占 1 位，base64 编码；
   - `coast` / `chinaCoast` / `border`：经纬度列表，单位为 0.01°。

**运行时部分**：`cap-dots.ts` 的 `createCapDots(set).frame(seam)`。
- 解码位图，每一帧对每个点调用 `sphereAngles` 和 `toView` 投影到屏幕。
- 以下情况不画：纬度超出当前范围（`capLatRange`）、卷曲后转到背面（`capFacing`）、落在画面之外。
- 返回 `{ land, coast, chinaLand, chinaCoast, border }`。`world-map-cap.tsx` 先画蓝色组，再画橙色组。
- **卷成整球时的抽稀**：点阵是为球冠设计的，经度比纬度密。卷成整球时，每行只均匀保留一部分点，让横向和纵向间距一致。球冠状态下完全不抽稀。

**性能**：每帧约 1.5 毫秒，所以地图每帧都重绘，不做节流。

**静态首帧**：SVG 就是接缝在 −95° 时的投影结果，和 Canvas 第一帧逐点对齐（误差只有取整造成的 0.05）。

**观感上的特点**：
- 点跟随球面透视：靠上沿（离镜头远）的行更密，靠下方（离镜头近）的行更疏；
- 行会顺着纬线微微弯曲；
- 首帧陆地点约 5000 个，旧做法约 3900 个。

**可调参数**：

| 想要的效果 | 改哪里 |
|---|---|
| 整体变疏或变密 | `REFERENCE_LATITUDE`（调高则整体变疏），或 `build(...)` 调用里的列距和行距 |
| 陆地点和海岸线之间的留白 | `build(...)` 的 `clearance` 参数（3.4 / 7） |
| 海岸线点的密度 | `build(...)` 的 `coast_spacing` 参数（2.6 / 6） |
| 点的大小 | `cap-dots.ts` 里的 `CAP_DOTS_DESKTOP` / `CAP_DOTS_MOBILE` |
| 颜色和透明度 | `world-map-cap.tsx` 里的 `COLOR`、`CHINA_COLOR`，以及 `layers` 里的 0.72 和 0.95 |

改完参数后，重新生成并校验：

```bash
python3 scripts/generate-demo-cap-map.py
python3 scripts/generate-demo-cap-map.py --check
```

### 4.2 另一种做法：点固定在屏幕上（提交 `4706b13` 及以前）

**尚未最终决定用哪一种**，目前保留 4.1 的做法。

- **原理**：屏幕上有一张固定的交错网格，间距 6 × 5.2。每一帧把每个格点反投影回球面（`unprojectCap`），查 0.5° 精度的陆地掩码，是陆地就点亮。海岸线点则每帧沿投影后的海岸线，按屏幕距离重新取样。
- **观感**：点的间距在屏幕上处处均匀，但转动时陆地内部的点是原地亮灭，海岸线点会沿着海岸"爬行"，看不出真正的转动。
- **性能**：每帧约 2.9 毫秒，所以当时限制地图每秒只重绘 24 次。

| | 固定在球面（现在） | 固定在屏幕（旧） |
|---|---|---|
| 转动感 | 真实平移，立体感强 | 原地闪烁 |
| 间距 | 随透视变化，北部偏密 | 处处均匀 |
| 每帧耗时 | 约 1.5 毫秒 | 约 2.9 毫秒 |
| 静态首帧对齐 | 逐点对齐 | 对齐 |

**如果要切回旧做法**，从 `4706b13` 取回以下文件，然后重新生成：
- `src/lib/demo/cap-dots.ts`
- `src/components/world-map-cap.tsx`（它里面有重绘节流 `MAP_REDRAW_INTERVAL`）
- `scripts/generate-demo-cap-map.py`

```bash
git checkout 4706b13 -- src/lib/demo/cap-dots.ts src/components/world-map-cap.tsx scripts/generate-demo-cap-map.py
```

注意：`e64aa39` 之后如果又改过这些文件，要手动合并。

**折中思路（未实现）**：点固定在球面上，但每行的点数随透视动态调整。代价是转动时会有点出现和消失。

## 5. 中国范围

- **数据来源**：`countries-110m.json` 中的 China（id 156）和 Taiwan（id 158）。其中已经包含阿克赛钦和沙克斯干谷。
- **生成脚本额外补充**：
  - **藏南**：`SOUTH_TIBET_LINE` 和 `SOUTH_TIBET_RING`，扣除了不丹、缅甸的部分；
  - **南海诸岛和钓鱼岛**：`ISLANDS`，每个岛一个点；
  - **十段线**：`TEN_DASH_LINE`。
- **国界的取法**：取中国和其他国家共用的 arc，也就是陆地国界；藏南范围内的那一段会被去掉。
- **注意**：
  - 这些补充的坐标都是**手工给出的近似值**，在这张地图的比例下看起来正确，但不是测绘数据；
  - 在中国大陆公开发布地图需要走审图流程，上线前请和合规负责人确认。

## 6. 城市与发射（`cap-cities.ts`、`world-map-cap-city-layer.tsx`）

- **中国枢纽**：`CAP_HUB`，位于东经 106°、北纬 33.5°，是一个大圆点，没有标签。北京、广州两个城市已经按要求合并掉。
- **海外城市**：共 10 个。`mobile: false` 的城市在地图宽度 ≤ 600px 时隐藏。
- **标签重叠**：通过 `below` 集合（Singapore、Frankfurt）把这两个城市的标签放到点的下方。靠近地图左右边缘时，标签会通过 `--tag-anchor` 向内偏移。
- **发射规则**：
  - 每 `BEAT`（1.6 秒）发射一颗，按 `capLaunchers` 里的跳跃顺序轮流选目的地；
  - 起点或终点只要有一端在可见面（淡出系数 ≥ 0.6）就可以发射；
  - 目的地上一颗彗星还没落地时跳过，顺延到下一个；
  - 页面恢复可见后，从当前时刻重新计时，不会把错过的节拍一次补发出来。
- **跨接缝的航线**：`capRoutePoints` 让航线走较短的那一边，只保留可见的部分，所以彗星会从地图边缘飞进来或飞出去。
- **淡出**：城市在靠近接缝时淡出。卷成地球后，城市在靠近球的轮廓时也会淡出。
- **标记贴合曲率**：点和光晕都用 `capSurfaceFrame` 生成的 CSS 矩阵 `--surface`，平躺在球面上，看起来是椭圆。标签不套用这个矩阵，始终保持竖直。

## 7. 彗星与冲击波（`cap-comet.ts`）

- **时间轴**：每颗彗星的生命周期按 14 秒的周期计算 `phase`。
  - `phase` 到 0.4（`TRAVEL`，约 5.6 秒）时撞击目的地；
  - 之后冲击波持续 `SHOCKWAVE.duration`（约 1.8 秒）。
- **`COMET`**：彗尾最长 960px，最多可占整条航线（`tailFraction: 1`）。头部有白热的亮核，外面有柔光。
- **`SHOCKWAVE`**：由四层组成，都贴在地面上，是椭圆：
  - 撞击瞬间的亮光；
  - 主冲击环：前沿线宽从粗变细，后面拖一圈能量带；
  - 次级回波：稍晚出现，尺寸为主环的 60%；
  - 7 道溅射火花。
- **画布边缘渐隐**：彗星画布左右两侧各有一段渐隐遮罩（`EDGE_CLEAR` / `EDGE_SOLID`）。

## 8. 导航与双语

- **导航参数**：来自 intercom.com 的实测值，按钮高 40px，面板描边 0.5px `#d3cec6`。背景是"顶部透明，滚动后变成毛玻璃"，这是用户确认过的选择。
- **语言切换**：点击后调用 Server Action 写入 cookie，在同一次请求里返回已切换语言的页面。
- **双语范围**：首页 Hero 和全部特性模块（`feature-copy.ts`）。

## 9. 卷成完整地球（仅演示页）

- **原理**：`setCapCurl(k)` 把 `SPAN_LON`、`SPAN_LAT`、纬度中心、倾角、镜头距离、取景参数，都从 `CAP` 插值到 `GLOBE`：
  - 倾角终点为 −18°，北方朝向观众；
  - 地球直径为画面高度的 88%。
- **首页不受影响**：curl = 0 时，所有输出与加卷曲功能之前逐位一致，已验证。
- **背面剔除**：由 `capFacing` 负责。卷曲后还会画出一个淡淡的球体轮廓。
- **演示页滚动结构**：260vh 的滚动轨道，里面是 sticky 舞台。页面容器的 `overflow-x` 必须是 `clip`，不能用 `hidden`，否则 sticky 不生效。

## 9.1 首页接力：Hero 平面地图 → 「AI 与流媒体解锁」模块的地球（2026-09-29）

首页不再只有 Hero：`HomeHero` = 导航 + `HomeRelay` + 其余特性模块（Bento、Tabs、客户端，来自 `/demo/features`）。

- **一张地图**：`src/components/home-relay.tsx`。桌面端（≥921px 且未开启减少动态效果）整页只有一张 `WorldMapCap`，放在吸顶舞台的 `mapLayer` 里：
  - 舞台里叠三层：`heroLayer`（原标题区，加一个空的 `heroSlot` 标出地图起点）、`mapLayer`（地图）、`unlockLayer`（`UnlockContent`，框里一个空的 `mapSlot` 标出地图终点）；
  - 两个 slot 的位置在挂载和 resize 时量一次；滚动时只改地图的 transform（translate + scale，从 heroSlot 到 mapSlot）和 `curlRef`，不改尺寸，Canvas 不重建；
  - 舞台可能比视口高（Hero 地图原本就伸到首屏以下），所以 sticky 的 `top` 设为 `视口高 − 舞台高`：先正常滚到地图底部露出，再吸住开始卷曲；
  - CSS 变量：`--p` 卷曲进度、`--h` 标题淡出、`--u` 模块标题和边框淡入、`--q` 请求/节点组/光束淡入（和独立模块一致）；
  - 地图位移比卷曲先走（ease-out），卷到一半的大地球不会沉到视口下方；
  - 遮罩：Hero 地图的四边渐隐随 `--p` 收掉；
  - p 越过 0.05 时 `routes` 切成 false，中国枢纽彗星停，只剩节点组光束；滚回顶部恢复；
  - `--q` 低于 0.5 时，请求到达不计数也不发光束（模块还藏在 Hero 后面）。
- **模块的动效：一次请求的往返**（`feature-unlock.tsx` 的 `UnlockContent`）。左侧 5 条固定的虚线轨道，请求小卡沿轨道滑到端口 → 一颗小光点飞进地球上的中国 → 橙色彗星从中国飞向目标城市并落地 → 绿色脉冲从城市沿原路飞回中国，落成绿色波纹 → 小卡变成「200 · 经 X · N ms」后淡出。约每 2.2 秒一个，同时约 3 个在飞。
  - **往返由地图自己画**：`WorldMapCap` 的 `tripRef` 收到一个函数，调用 `tripRef.current({ city, onReturn })` 播放一次往返；中国或目标城市不在可见面时返回 `false`（城市层 `world-map-cap-city-layer.tsx` 的 `CapTrip`，用合成的 phase 复用 `drawComet` / `drawShockwave`，绿色样式是 `cap-comet.ts` 的 `GREEN`）。往返期间目标城市的标签边框 `data-hot`：出站橙色、返回绿色。
  - **镜头**：`WorldMapCap` 的 `steerRef` 存"画面中心经度"，非空时地球缓慢转向 `经度 − 180` 这个 seam（最大 45°/s，指数缓动），为空则照旧匀速自转。模块分两场：亚太（中心 128°E，AI 服务，东京 / 新加坡 / 悉尼 / 孟买）和欧亚（中心 62°E，流媒体，伦敦 / 法兰克福 / 约翰内斯堡 / 孟买 / 新加坡），每场 5 个请求，再等 4 秒让最后的应答走完，然后转向下一场。地球只能绕轴转，所以一个画面只能容纳经度相差约 60° 以内的城市，美洲没法和中国同屏（想加要另做一场，贴着地平线）。
  - 两个调用方（`FeatureUnlock` 与 `home-relay.tsx`）用 `useGlobeLink()` 拿到这对 ref，同时传给地图和 `UnlockContent`。
  - **节点图（2026-09-29 改）**：左侧是 Flora 风格的节点图（连线画法见 `src/lib/demo/flow-line.ts`）：4 个服务节点 → 「AeraNexa 智能路由」节点 → 地球外圈的圆环（圆心与地球重合，半径 + 14px）。路由节点到圆环有两条线：请求线进左上端口，应答线从左下端口出；橙色脉冲走请求线，绿色脉冲沿应答线反向跑回。服务节点和路由节点可以拖拽（连线实时跟随，位置记在槽位上），地球和圆环不可拖。
  - 往返的 `CapTrip` 有可选的 `delay`（秒），页面可以先挑好城市、之后再开始往返；页面隐藏或主线程卡顿后，往返从暂停处继续，不会被丢掉。
- **手机端和减少动态效果**：不接力。Hero 保持原来的平面地图，下面放独立的 `FeatureUnlock`（自带一张地球，走手机布局）。
- **双语**：特性模块文案都在 `src/lib/feature-copy.ts`，写法同 `home-copy.ts`；组件都接收 `locale`，`/demo/features` 也读同一个 cookie。

## 10. 验证方法（下次沿用）

- **生成产物可复现**：`python3 scripts/generate-demo-cap-map.py --check`。
- **在 Node 里直接调用 TS 模块**（项目没有装 tsx，用 jiti，需要配置 `@` 别名）：

  ```bash
  JITI_ALIAS='{"@":"/Volumes/UGREEN/Code/React/AeraNexa/src"}' node_modules/.bin/jiti some-script.ts
  ```

  以前用这种方式做过的检查：
  - 首帧与静态 SVG 逐点比对；
  - 转一整圈，检查标签有没有重叠；
  - 发射调度模拟：统计空拍、各城市命中次数、同时在飞的数量；
  - 每帧耗时。
- **浏览器验证技巧**：
  - 浏览器面板被隐藏时，requestAnimationFrame 会暂停；
  - 预览窗口高度只有 260 左右，要看完整页面，用 `resize_window` 模拟 1440×900；
  - 看细节时，把地图 Canvas 用 `drawImage` 复制出来，拼成对比图，再用一个固定定位的 `<img>` 放大显示；
  - 判断点阵是否真的在转：把相隔 1 秒的两帧分别染成红、蓝两色叠加。整体平移就说明点在跟着地图转。
- **lint 注意**：`pnpm lint` 会扫描到构建产物目录 `.next-push-build/` 并报错，只对改动过的文件单独跑 `npx eslint <files>` 即可。

## 11. 遗留问题

1. **陆地点阵的做法未定**：见 4.2。
2. **减少动态效果模式下没有连线**：系统开启"减少动态效果"时，地图保持静态 SVG，没有任何连线和彗星。
3. **未使用的组件**：`src/components/home-network-visualization.tsx` 已经没有地方在用，可以删除。
4. **lint 忽略列表**：`.next-push-build/` 还没加进 eslint 的忽略列表。
5. **整球状态的观感**：卷成整球后，陆地点比球冠稀；海岸线点偏密，看起来像实线；卷到一半时，非洲一带有隐约的纹理。
6. **最南端的一段十段线**：它紧贴婆罗洲的海岸线，几乎和海岸线点重合在一起。
7. **未跟踪的文件**：`.claude/`、`.workbuddy/`、`design-qa.md` 一直没有纳入 git，也不属于这项工作。
