// Builds the static demo site (demo-site/) into demo-site/out, for any static host (EdgeOne Pages, Netlify, …).
// It has no back end: see docs/demo-site.md.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "demo-site");

// The site shares the app's public/ folder (fonts, images, icons); Next serves whatever is in its own project's public/.
rmSync(path.join(site, "public"), { recursive: true, force: true });
cpSync(path.join(root, "public"), path.join(site, "public"), { recursive: true });
// The app's icons sit in src/app (file-based metadata), which the demo site does not use.
for (const file of ["icon.svg", "apple-icon.png"]) {
  const from = path.join(root, "src", "app", file);
  if (existsSync(from)) cpSync(from, path.join(site, "public", file));
}
mkdirSync(path.join(site, "public"), { recursive: true });

rmSync(path.join(site, "out"), { recursive: true, force: true });
const result = spawnSync("npx", ["next", "build"], { cwd: site, stdio: "inherit", shell: process.platform === "win32" });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log("\nDemo site built: demo-site/out");
