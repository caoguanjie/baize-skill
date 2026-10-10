import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { display_width } from "../../scripts/chain_layout.mjs";
import { build_repo } from "./testkit.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));

test("发布的 .mjs 排版示例可直接运行，保持 99 列", () => {
  const file = path.join(root, "examples", "render-detail.mjs");
  const result = spawnSync(process.execPath, [file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.stdout
      .trimEnd()
      .split("\n")
      .every((line) => Math.abs(display_width(line) - 99) <= 0.5),
  );
  const reference = fs.readFileSync(
    path.join(root, "references", "版式规范.md"),
    "utf8",
  );
  const examples = [...reference.matchAll(/```javascript\n([\s\S]*?)```/g)];
  assert.ok(examples.length);
  for (const [, code] of examples) {
    const output = spawnSync(process.execPath, ["--input-type=module"], {
      input: code,
      cwd: path.join(root, "examples"),
      encoding: "utf8",
    });
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.stdout, result.stdout);
  }
});
test("没有 Python、npm 或 Git 的 PATH 时仍能进行静态检查和反查", (t) => {
  const repo = build_repo();
  t.after(() => repo.cleanup());
  const url = pathToFileURL(path.join(root, "scripts", "chain.mjs")).href;
  for (const args of [["check"], ["refs", "login_or_register"]]) {
    const code = `import {main} from ${JSON.stringify(url)};process.exitCode=main(${JSON.stringify(args)},${JSON.stringify(repo.settings)});`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", code],
      { cwd: repo.root, env: { ...process.env, PATH: "" }, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, args[0] === "check" ? /错误 0 条/ : /N2.01/);
  }
});
