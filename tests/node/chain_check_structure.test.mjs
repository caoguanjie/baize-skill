import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build_repo, L, M1, M2, MR } from "./testkit.mjs";
import { run_check, check_structure } from "../../scripts/chain_check.mjs";
import { render_detail } from "../../scripts/chain_layout.mjs";
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
const check = (r, targets = []) => run_check(r.root, targets, false, settings);
const has = (issues, s) =>
  assert.ok(
    issues.some((i) => i.message.includes(s)),
    s,
  );
for (const [name, rel, old, value, message] of [
  [
    "submodule jump missing",
    L,
    "==> 子模块 2：会话",
    "==> 子模块 3：会话",
    "跳转目标不存在：==> 子模块 3：会话",
  ],
  [
    "submodule name mismatch",
    L,
    "==> 子模块 2：会话",
    "==> 子模块 2：会话X",
    "跳转名称不一致：==> 子模块 2：会话X，实际是「会话」",
  ],
  [
    "module jump wrong sub",
    M1,
    "==> 模块：支付 / 扣款",
    "==> 模块：支付 / 退款",
    "跳转目标不存在：==> 模块：支付 / 退款",
  ],
  [
    "business jump missing",
    L,
    "==> 子模块 2：会话",
    "==> 业务：库存",
    "跳转目标不存在：==> 业务：库存",
  ],
  [
    "unknown jump",
    L,
    "==> 子模块 2：会话",
    "==> 页面：登录",
    "无法识别的跳转：==> 页面：登录",
  ],
  [
    "overview list differs",
    L,
    "[2] 会话\n```",
    "[2] 会话中\n```",
    "总览图与清单不一致",
  ],
  [
    "submodule headings differ",
    L,
    "## 子模块 2：会话",
    "## 子模块 3：会话",
    "清单与子模块标题不一致",
  ],
  [
    "list entry absent in anchors",
    L,
    "`LoginService.login_or_register()` | 完成",
    "`LoginService.login()` | 完成",
    "清单入口不在锚点表",
  ],
  [
    "module entry differs",
    MR,
    "server/app/payment.py:3 `charge_payment()`",
    "server/app/payment.py:6 `publish()`",
    "模块入口与首个子模块入口不同",
  ],
  [
    "anchor missing",
    L,
    "| N2.03 | web/src/store/auth.ts:6 | `commitSession()` |\n",
    "",
    "节点缺少锚点：N2.03",
  ],
  [
    "left duplicate node",
    L,
    "数据 [N2.02]",
    "数据 [N2.01]",
    "节点编号不连续或重复",
  ],
  [
    "card method not in anchor",
    L,
    "方法：LoginService.login_or_register()",
    "方法：foo()",
    "卡片方法不在锚点表：foo()",
  ],
  ["unknown layer", L, "[N2.03] 状态层", "[N2.03] 视图层", "未知层名：视图层"],
  [
    "unknown field",
    L,
    "方法：commitSession()",
    "说明：commitSession()",
    "未知字段：说明",
  ],
  [
    "width overflow",
    L,
    "[1] 发码\n",
    "[1] 发码\n" + "x".repeat(101) + "\n",
    "图宽超限：101 列，上限 100",
  ],
  [
    "unknown header cannot bypass",
    L,
    "| 子模块 | 做什么 | 入口 | 交给下一步 |",
    "| 随意名 | 做什么 | 入口 | 交给下一步 |",
    "清单表头不符合约定：应为 子模块",
  ],
])
  test(name, (t) => {
    const r = fixture(t);
    r.edit(rel, old, value);
    has(check(r), message);
  });
test("card duplicates and orphans have separate diagnostics", (t) => {
  const r = fixture(t);
  r.edit(L, "[N2.03] 状态层", "[N2.02] 状态层");
  has(check(r, [L]), "重复卡片：N2.02");
  r.edit(L, "[N2.02] 状态层", "[N2.03] 状态层");
  r.edit(L, "状态 [N2.03]", "状态结束");
  has(check(r, [L]), "卡片节点不在详图：N2.03");
});
test("border/center/card alignments remain enforced", (t) => {
  const r = fixture(t);
  const line = r
      .read(L)
      .split("\n")
      .find((l) => l.includes("步骤 [N1.01]")),
    middle = [...line].flatMap((c, i) => (c === "|" ? [i] : []))[1];
  r.edit(
    L,
    line,
    line.slice(0, middle) +
      "  " +
      line.slice(middle, middle + 2) +
      line.slice(middle + 4),
  );
  has(check(r, [L]), "详图中线偏移");
});
function replace_detail(r, rel, section, left, cards) {
  const text = r.read(rel),
    start =
      text.indexOf("```text\n+", text.indexOf("## 子模块 " + section)) + 8,
    end = text.indexOf("\n```", start);
  r.write(
    rel,
    text.slice(0, start) +
      render_detail(
        `子模块 ${section}：${section === 1 ? "建单" : "会话"}`,
        left,
        cards,
      ) +
      text.slice(end),
  );
}
test("wrapped module jump must match whole target; exact jumps ignore commentary", (t) => {
  const r = fixture(t);
  replace_detail(r, M1, 1, ["建单 [N1.01]", "==> 模块：支", "付错误"], {
    "N1.01": ["应用层", ["方法：confirm_order()", "组件：OrderSummary"]],
  });
  has(check(r, [M1]), "跳转目标不存在：==> 模块：支付错误");
  replace_detail(
    r,
    M1,
    1,
    ["建单 [N1.01]", "==> 模块：支付 / 扣款", "同列解释文字"],
    { "N1.01": ["应用层", ["方法：confirm_order()", "组件：OrderSummary"]] },
  );
  assert.deepEqual(check(r, [M1]), []);
});
test("new overview index validates headings, missing rows and exact links", (t) => {
  const r = fixture(t),
    rel = MR.replace("README.md", "总览.md");
  fs.renameSync(path.join(r.root, MR), path.join(r.root, rel));
  r.edit("docs/链路全景/README.md", "业务/订单/README.md", "业务/订单/总览.md");
  r.edit(
    rel,
    "| 模块 | 做什么 | 入口 | 交给下一步 | 文档 |\n| --- | --- | --- | --- | --- |\n| [1] 下单 | 建单 | server/app/orders/confirm.py:1 `confirm_order()` | 下一步 | [01-下单.md](01-下单.md) |\n| [2] 支付 | 扣款 | server/app/payment.py:3 `charge_payment()` | 完成 | [02-支付.md](02-支付.md) |",
    "| 模块 | 做什么 | 交给下一步 | 详情 |\n| --- | --- | --- | --- |\n| [1] 下单 | 建单 | 下一步 | [查看模块](01-下单.md) |\n| [2] 支付 | 扣款 | 完成 | [查看模块](02-支付.md) |",
  );
  r.write(
    rel,
    r.read(rel) +
      "\n## 子模块索引\n\n| 模块 | 子模块 | 这一段看什么 |\n| --- | --- | --- |\n| 01 下单 | [1 建单](01-下单.md#子模块-1建单) | 建单 |\n| 02 支付 | [1 扣款](02-支付.md#子模块-1扣款) | 扣款 |\n",
  );
  assert.deepEqual(check(r, [rel]), []);
  r.edit(rel, "01-下单.md#子模块-1建单", "01-下单.md#总览");
  has(check(r, [rel]), "子模块索引目标不一致");
  r.edit(rel, "#子模块-1扣款", "#子模块-1不存在");
  has(check(r, [rel]), "标题锚点不存在");
});
test("whole-file entry matches same source anchor only", () => {
  const anchor = {
      path: "jobs/report.sh",
      tokens: [],
      node: "N1.01",
      doc_line: 10,
    },
    entry = { path: "jobs/report.sh", tokens: [] },
    doc = {
      path: "docs/链路全景/业务/report.md",
      kind: "单文件",
      h1: "report",
      h1_line: 1,
      overview: {
        line: 2,
        list_kind: "子模块",
        rows: [{ number: 1, name: "执行", entry, doc_line: 3 }],
        nodes: [],
        diagram: null,
      },
      submodules: [
        { number: 1, name: "执行", line: 5, diagram: null, anchors: [anchor] },
      ],
    };
  assert.ok(
    !check_structure(doc, {}).some((i) =>
      i.message.includes("清单入口不在锚点表"),
    ),
  );
  anchor.path = "jobs/other.sh";
  has(check_structure(doc, {}), "清单入口不在锚点表");
});
