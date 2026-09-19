/**
 * 注册 ./ts-hooks.mjs，让 Node 直接运行 src/ 下的 TypeScript。
 * 用法：node --import ./scripts/ts-register.mjs …（节点 worker 与 tests/node-domain 共用）
 */
import { register } from "node:module";

register(new URL("./ts-hooks.mjs", import.meta.url));
