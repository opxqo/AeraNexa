# SEO 备忘

SEO 工作尚未开始。这里先记下已经定好的规则，动手做 SEO 时从这里开始。

## 品牌命名（2026-09-25 确定）

| 名称 | 用途 |
| --- | --- |
| **AeraNexa**（英文名） | UI 界面的主品牌：Logo 旁的名字、页面文案、页面标题主体 |
| **天赐**（中文名） | 搜索引擎优化：让中文用户搜「天赐」能找到本站 |

- UI 上继续以 AeraNexa 为主，**不要把界面里的品牌名换成中文**。
- 搜索引擎能读到的地方同时带上中文名，写法统一为「AeraNexa 天赐」。

## 做 SEO 时要改的位置

- `src/app/layout.tsx` 的 `metadata`：
  - `title.default` 改为「AeraNexa 天赐」一类写法；`title.template` 的后缀视情况带上中文名；
  - `description` 目前是英文的「AeraNexa secure network service portal」，改成包含「天赐」的中文描述；
  - 加 `keywords`、`openGraph`（`siteName`、`title`、`description`、分享图）、`twitter`、`alternates.canonical`。
- 首页、登录页、注册页等公开页面，各自写有针对性的 `title` 和 `description`。
- 结构化数据（JSON-LD `Organization` / `WebSite`）：`name` 用 AeraNexa，`alternateName` 填「天赐」。
- 新增 `src/app/robots.ts` 和 `src/app/sitemap.ts`（目前都没有）：后台 `/admin`、用户中心、`/api` 等需要登录的路径禁止收录，只开放公开页面。
- `<html lang="zh-CN">` 已经是中文，保持不变。

## 现状（2026-09-25）

- 代码里还没有出现「天赐」。
- `metadata` 只有英文标题和一句英文描述，没有 robots、sitemap、Open Graph。
