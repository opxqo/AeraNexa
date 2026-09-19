/**
 * V2Board 兼容路径：迁移前已分发出去的 `/api/v1/client/subscribe?token=…` 继续可用。
 * 静态路由优先于同级的 `[...path]` 代理，因此订阅不再被转发到旧 V2Board。
 */
export { GET } from "@/app/api/client/subscribe/route";

// 路由段配置必须在本文件内字面声明，Next.js 不识别 re-export。
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
