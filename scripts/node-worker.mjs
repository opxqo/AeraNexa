/**
 * 节点 worker 入口：注册 TS 解析钩子后启动 src/worker/index.ts。
 *
 *   pnpm worker          # 读取 .env.local
 *   node --env-file=/etc/aeranexa.env scripts/node-worker.mjs   # 生产
 */
import "./ts-register.mjs";

await import(new URL("../src/worker/index.ts", import.meta.url).href);
