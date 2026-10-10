/** 只运行原生 Node 测试；不需要 npm 包，也不启动 Python。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const folder = fileURLToPath(new URL("./node/", import.meta.url));
const files = fs
  .readdirSync(folder)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join(folder, name));
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  windowsHide: true,
});
if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;
