"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build_repo, L, M2 } from "./testkit.mjs";
import * as implementation from "../../scripts/chain_check.mjs";
import * as doc_api from "../../scripts/chain_doc.mjs";
const api = () => implementation;
const settings = {
  contract: "api/openapi.json",
  layers: [
    "页面层",
    "组件层",
    "状态层",
    "接口层",
    "应用层",
    "服务层",
    "数据层",
    "异步层",
  ],
  extra_fields: ["组件"],
};
function fixture(t) {
  const r = build_repo();
  t.after(() => r.cleanup());
  return r;
}
function check(r, targets = []) {
  return api().run_check(r.root, targets, false, settings);
}
test("baseline complete fixture has no errors or hints", (t) => {
  const r = fixture(t);
  assert.deepEqual(check(r), []);
});
test("anchors, symbols, selectors, tables and events preserve diagnostics", (t) => {
  const r = fixture(t);
  r.edit("server/app/login.py", "login_or_register", "login_or_register_v2");
  r.edit("web/src/views/Login.vue", "quick-login", "fast-login");
  r.edit("server/app/models.py", "app_user", "app_member");
  r.edit("server/app/payment.py", "order.payment.requested", "order.x");
  const issues = check(r);
  for (const m of [
    "符号不存在：login_or_register",
    "选择器不存在：quick-login",
    "表不存在：app_user",
    "事件不存在：order.payment.requested",
  ])
    assert.ok(issues.some((i) => i.message.includes(m)));
});
test("missing files and capability docs are errors", (t) => {
  const r = fixture(t);
  r.edit(L, "web/src/views/Login.vue:3", "web/src/views/Nope.vue:3");
  fs.unlinkSync(path.join(r.root, "docs/链路全景/能力/消息通知.md"));
  const issues = check(r);
  assert.ok(
    issues.some((i) => i.message === "文件不存在：web/src/views/Nope.vue"),
  );
  assert.ok(
    issues.some(
      (i) => i.message === "能力文档不存在：docs/链路全景/能力/消息通知.md",
    ),
  );
});
test("OpenAPI malformed/missing contract behavior", (t) => {
  const r = fixture(t);
  r.write("api/openapi.json", "{broken");
  assert.equal(check(r)[0].message, "OpenAPI 解析失败：api/openapi.json");
  r.write("api/openapi.json", '{"paths":{"/api/login":{"get":{}}}}');
  assert.ok(
    check(r).some(
      (i) => i.message === "接口不存在：POST /api/login（api/openapi.json）",
    ),
  );
  fs.unlinkSync(path.join(r.root, "api/openapi.json"));
  const issues = check(r, [L]);
  assert.equal(
    issues.filter((i) => i.message.includes("跳过接口核对")).length,
    1,
  );
});
test("line drift is hint; contract-less settings skip only configured checks", (t) => {
  const r = fixture(t);
  r.edit("server/app/login.py", "class LoginService:", "\nclass LoginService:");
  const issues = check(r);
  assert.ok(
    issues.some((i) => i.level === "提示" && i.message.includes("行号漂移")),
  );
  assert.ok(!issues.some((i) => i.level === "错误"));
  assert.ok(
    api()
      .run_check(r.root, [L])
      .some((i) => i.message.includes("项目设置未提供接口契约")),
  );
});
test("link URL decoding, inline code, fenced code and Unicode heading slugs", (t) => {
  const r = fixture(t);
  r.write("docs/业务链路/a b.md", "# 旧\n\n## 子模块 1：标题\n");
  r.edit(
    "docs/链路全景/README.md",
    "# 链路全景",
    "# 链路全景\n\n[旧](<../业务链路/a b.md>) [旧2](../业务链路/a%20b.md#子模块-1标题)\n`[忽略](missing.md)`\n```\n[忽略](missing.md)\n```",
  );
  assert.deepEqual(check(r), []);
  r.edit("docs/链路全景/README.md", "#子模块-1标题", "#错误");
  assert.ok(check(r).some((i) => i.message.includes("标题锚点不存在")));
});
test("description conflicts keep target filtering and Python ordering", (t) => {
  const r = fixture(t);
  r.edit(L, "表 `app_user` 读写 |", "表 `app_user` 读写（甲表） |");
  r.edit(M2, "表 `app_user` 读 |", "表 `app_user` 读（乙表） |");
  const issues = check(r, [L]);
  assert.ok(
    issues.some(
      (i) =>
        i.message === "表中文说明冲突：app_user（乙表、甲表），请核对表注释",
    ),
  );
  assert.ok(issues.every((i) => i.doc === L));
});
test("freshness notices source commits and skips edited docs", (t) => {
  const r = fixture(t);
  r.edit(
    "server/app/login.py",
    "async def login(body):",
    "async def login(body):  # edited",
  );
  r.commit();
  assert.ok(
    check(r).some((i) => i.message.includes("可能过期：server/app/login.py")),
  );
  r.edit(L, "> 最后核对：", "> 最后核对（编辑中）：");
  assert.ok(!check(r, [L]).some((i) => i.message.includes("可能过期")));
});
test("connectors and branch layouts detect invalid alignments", () => {
  assert.equal(
    api().check_connectors("x", "总览", 1, ["    |", "    v"]).length,
    0,
  );
  assert.ok(api().check_connectors("x", "总览", 1, ["    |", "     v"]).length);
  assert.ok(
    api()
      .check_branch_layout("x", "总览", 1, ["+--> first", "+-- second -->"])
      .some((i) => i.message.includes("分支版式错误")),
  );
});
test("heading casefold uses complete pinned Unicode mappings and Python whitespace", () => {
  assert.equal(api()._heading_slug("## ẞ և Σς ﬃ"), "ss-եւ-σσ-ffi");
  assert.equal(api()._heading_slug("## A\x85B"), "a-b");
});
test("missing Git remains optional for freshness", (t) => {
  const r = fixture(t),
    previous = process.env.PATH;
  try {
    process.env.PATH = "";
    assert.deepEqual(api().check_freshness(r.root, r.doc(L)), []);
  } finally {
    process.env.PATH = previous;
  }
});

test("absolute local links retain absolute file and fragment resolution", (t) => {
  const r = fixture(t),
    file = path.join(r.base, "absolute local.md");
  fs.writeFileSync(file, "# External local\n\n## Exact heading\n");
  const doc = {
    path: L,
    links: [[file, 1]],
    lines: [`[absolute](<${file}#exact-heading>)`],
  };
  assert.deepEqual(api().check_links(r.root, doc), []);
  doc.lines = [`[absolute](<${file}#missing-heading>)`];
  assert.equal(
    api().check_links(r.root, doc)[0].message,
    `标题锚点不存在：${file}#missing-heading`,
  );
});

test("freshness Git reads are memoized only within one check run", async (t) => {
  const r = fixture(t);
  const { default: child_process } = await import("node:child_process");
  const { syncBuiltinESMExports } = await import("node:module");
  const original = child_process.spawnSync;
  const calls = [];
  child_process.spawnSync = function (command, args, options) {
    if (command === "git" && options?.cwd === r.root)
      calls.push(JSON.stringify([options.cwd, args]));
    return original(command, args, options);
  };
  syncBuiltinESMExports();
  try {
    assert.deepEqual(check(r), []);
    const first = [...calls],
      counts = new Map();
    for (const command of first)
      counts.set(command, (counts.get(command) || 0) + 1);
    assert.equal(
      counts.get(
        JSON.stringify([r.root, ["rev-parse", "--is-inside-work-tree"]]),
      ),
      1,
    );
    assert.ok(
      [...counts.values()].every((count) => count === 1),
      "same root and Git args execute once per run",
    );
    r.edit(
      "server/app/login.py",
      "async def login(body):",
      "async def login(body):  # fresh source change",
    );
    const issues = check(r);
    assert.ok(
      issues.some(
        (i) => i.message === "可能过期：server/app/login.py 在文档提交后有改动",
      ),
    );
    const second = calls.slice(first.length),
      second_counts = new Map();
    for (const command of second)
      second_counts.set(command, (second_counts.get(command) || 0) + 1);
    assert.equal(
      second_counts.get(
        JSON.stringify([r.root, ["rev-parse", "--is-inside-work-tree"]]),
      ),
      1,
    );
    assert.ok([...second_counts.values()].every((count) => count === 1));
    const status = JSON.stringify([
      r.root,
      ["status", "--porcelain", "--", "server/app/login.py"],
    ]);
    assert.equal(
      calls.filter((command) => command === status).length,
      2,
      "new run reads changed source status again",
    );
  } finally {
    child_process.spawnSync = original;
    syncBuiltinESMExports();
  }
});
