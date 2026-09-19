/**
 * 让 Node 直接运行 src/ 下的 TypeScript（节点 worker 用）。
 *
 * Node 22.18+ 已能剥离类型，但还差三件事，这里用模块解析钩子补上：
 * - `server-only`：Next.js 内置的守卫包，worker 本来就是服务端，解析为空模块；
 * - `@/…`：tsconfig 的路径别名，映射到 src/；
 * - 无扩展名的相对导入：依次尝试 .ts / .tsx / /index.ts。
 *
 * 注意：被 worker 引用到的源码只能用「可擦除」的 TS 语法（不能用 enum、构造参数属性等）。
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const srcRoot = new URL("../src/", import.meta.url);
const CANDIDATES = [".ts", ".tsx", "/index.ts"];

function resolveTs(baseUrl) {
  if (existsSync(fileURLToPath(baseUrl))) return baseUrl.href;
  for (const suffix of CANDIDATES) {
    const candidate = new URL(baseUrl.href + suffix);
    if (existsSync(fileURLToPath(candidate))) return candidate.href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export {};", shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const url = resolveTs(new URL(specifier.slice(2), srcRoot));
    if (url) return { url, shortCircuit: true };
  }
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  if (isRelative && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const url = resolveTs(new URL(specifier, context.parentURL));
    if (url) return { url, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

