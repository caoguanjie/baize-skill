"use strict";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build_repo, L } from "./testkit.mjs";
import * as implementation from "../../scripts/chain_fix.mjs";
import * as doc_api from "../../scripts/chain_doc.mjs";
const api = () => implementation;
function fixture(t) {
  const r = build_repo();
  t.after(() => r.cleanup());
  return r;
}
test("cross table preserves business grouping, thresholds and order", (t) => {
  const r = fixture(t);
  const d = doc_api;
  const docs = d.discover_docs(r.root).map((n) => d.parse_doc(r.root, n));
  assert.equal(
    api().build_cross_table(docs),
    "| 类型 | 名称 | 登录 | 订单 |\n| --- | --- | --- | --- |\n| 能力 | 消息通知 | - | 调用 |\n| 表 | app_user | 读写 | 读 |\n",
  );
  assert.equal(api()._actions(new Set(["读", "写"])), "读写");
});
test("line fix is byte-limited, preserves CRLF and idempotent", (t) => {
  const r = fixture(t);
  const file = path.join(r.root, L);
  fs.writeFileSync(file, r.read(L).replaceAll("\n", "\r\n"));
  r.edit("server/app/login.py", "class LoginService:", "\nclass LoginService:");
  const before = fs.readFileSync(file, "utf8");
  const issues = api().fix_line_numbers(r.root, r.doc(L));
  assert.ok(issues.some((i) => i.message.includes("已修正行号")));
  const once = fs.readFileSync(file, "utf8");
  assert.equal(
    before.replace(/(\.\w+):\d+/g, "$1:#"),
    once.replace(/(\.\w+):\d+/g, "$1:#"),
  );
  assert.ok(!once.replaceAll("\r\n", "").includes("\n"));
  assert.deepEqual(api().fix_line_numbers(r.root, r.doc(L)), []);
  assert.equal(fs.readFileSync(file, "utf8"), once);
});
test("ambiguous definitions fail and preserve locator", (t) => {
  const r = fixture(t);
  r.write(
    "server/app/login.py",
    "\nclass A:\n    def login_or_register(self): ...\nclass LoginService:\n    async def login_or_register(self,phone): ...\n\n\nasync def login(body):\n",
  );
  const issues = api().fix_line_numbers(r.root, r.doc(L));
  assert.ok(
    issues.some(
      (i) =>
        i.level === "错误" &&
        i.message.includes("无法唯一定位：login_or_register"),
    ),
  );
  assert.ok(r.read(L).includes("server/app/login.py:2"));
  assert.ok(r.read(L).includes("server/app/login.py:8"));
});
test("definition matching preserves all supported languages and excludes calls", () => {
  for (const source of [
    "async def save():",
    "function* save() {}",
    "class save {}",
    "fun save() {}",
    "func (s *Service) save() {}",
    "const save = () => {}",
    "public void save() {}",
    "Task<Order?> save() {}",
  ])
    assert.deepEqual(api()._definition_lines([source], "save"), [1], source);
  for (const source of ["return save(x)", "await save(x)", "new save(x)"])
    assert.deepEqual(api()._definition_lines([source], "save"), [], source);
});
test("comments and quoted pseudo-definitions are excluded; annotation declaration is kept", () => {
  const lines = [
    "class Orders {",
    "  /*",
    "  public void save(String value) {}",
    "  */",
    '  @SuppressWarnings("unused") public void save(String value) {}',
    '  void call() { save("x"); }',
    "}",
  ];
  assert.deepEqual(api()._definition_lines(lines, "save"), [5]);
  assert.deepEqual(
    api()._definition_lines(
      ["class Orders {", " /* public void save(String value) {} */", "}"],
      "save",
    ),
    [],
  );
  assert.deepEqual(
    api()._definition_lines(
      [
        'String url = "https://example.invalid/*demo*/";',
        "public void save(String value) {}",
      ],
      "save",
    ),
    [2],
  );
});
test("comment-only symbol cannot produce a line-number repair", (t) => {
  const r = fixture(t);
  r.write("server/app/login.py", "# async def login_or_register(self): ...\n");
  const before = r.read(L);
  const issues = api().fix_line_numbers(r.root, r.doc(L));
  assert.ok(
    issues.some((i) => i.message.includes("无法唯一定位：login_or_register")),
  );
  assert.equal(r.read(L), before);
});
test("fix inside details leaves all unrelated bytes intact", (t) => {
  const r = fixture(t);
  r.edit(
    L,
    "### 对应源码入口\n\n",
    "<details>\n<summary>对应源码入口</summary>\n\n",
  );
  r.edit(L, "\n## 子模块 2：会话", "\n</details>\n\n## 子模块 2：会话");
  const before = r.read(L);
  r.edit(
    "server/app/login.py",
    "async def login(body):",
    "\nasync def login(body):",
  );
  const issues = api().fix_line_numbers(r.root, r.doc(L));
  assert.ok(
    issues.some((i) => i.message === "已修正行号：server/app/login.py 5 -> 6"),
  );
  assert.equal(
    r.read(L).replace("server/app/login.py:6", "server/app/login.py:5"),
    before,
  );
});
