import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import * as doc from "../../scripts/chain_doc.mjs";
import { render_detail, place_at } from "../../scripts/chain_layout.mjs";
const plain = (value) => JSON.parse(JSON.stringify(value));
const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/chain_doc_oracles.json", import.meta.url),
    "utf8",
  ),
);
function oracle(fn, args) {
  return fixtures[
    JSON.stringify([fn, fn === "parse_doc" ? args.slice(1) : args])
  ];
}

test("表格仅按未转义且不在任意反引号围栏中的竖线切分", () => {
  assert.deepEqual(
    doc.split_table_row("| N1.01 | a.py:3 | 表达式 ``a | b`` 与 \\| |"),
    ["N1.01", "a.py:3", "表达式 ``a | b`` 与 |"],
  );
  for (const line of [
    "x | y",
    " |a|",
    "| ``a | b` | c`` |",
    "|x\\|y|z|",
    "|a|b\\|",
  ])
    assert.deepEqual(
      doc.split_table_row(line),
      oracle("split_table_row", [line]),
    );
});

test("类型、动作、中文表描述及Unicode单词边界与Python一致", () => {
  for (const value of [
    "按钮 `.quick-login` → `handleQuickLogin()`；表 `app_user` 读写（应用用户表）；接口 `POST /api/login`；事件 `x.y` 发布；路由 `/home`",
    "表 `x` 读写中文",
    "事件 `x` 发布é",
    "表 `x`\u001c写（说明）",
    "`foo.bar()` `#x` `data-testid=x` `a-b`",
  ])
    assert.deepEqual(
      plain(doc.classify_tokens(value)),
      oracle("classify_tokens", [value]),
    );
  assert.equal(
    new doc.Issue("a.md", 3, "文档", "错误", "无入口").render(),
    "a.md:3 文档 错误：无入口",
  );
});

test("跳转、折行续名及双栏卡片字段的结构与行号不变", () => {
  for (const line of [
    "| 提示 ==> 子模块 2     |",
    "==> 模块：支付 / 扣款",
    "==> 页面：登录",
    "=> 模块：支付",
    "===> 子模块 2",
    "=> 其他文本",
    "==> 模块 02：支付",
    "==> 业务：订单",
  ])
    assert.deepEqual(
      plain(doc.parse_jumps(line, 7)),
      oracle("parse_jumps", [line, 7]),
    );
  const diagram = render_detail(
    "子模块 1：执行",
    ["反馈 [N1.01]", "==> 子模块 2：会话"],
    {
      "N1.01": [
        "状态层",
        ["方法：foo()", "失败：" + "中".repeat(21) + "原因：失效"],
      ],
    },
  );
  assert.deepEqual(
    plain(doc.parse_diagram(diagram.split("\n"), 10, true)),
    oracle("parse_diagram", [diagram.split("\n"), 10, true]),
  );
  const lines = [
    place_at("资料齐全 ", "=> 模块：反馈与", 12),
    place_at("无 ", "状态同步", 12),
  ];
  assert.deepEqual(
    plain(doc.parse_diagram(lines, 1, true)),
    oracle("parse_diagram", [lines, 1, true]),
  );
});

test("下划线解析函数、定位拒绝及链接转义保持Python合同", () => {
  const cases = [
    ["_kind", ["docs/链路全景/业务/订单/02-支付.md"]],
    ["_kind", ["docs/链路全景/能力/通知.md"]],
    ["_kind", ["./docs//链路全景/README.md"]],
    ["_blocks", [["x", "```text", "a", "```", "y"], 0, 5]],
    [
      "_table",
      [["x", "| 节点 | 入口 |", "| --- | --- |", "| N1.01 | a.py |"], 0, 4],
    ],
    ["_locator", ["a.py:3 `foo()`", "`foo()`", 7]],
    ["_locator", ["../a.py:3", "", 7]],
    [
      "_links",
      [
        [
          "[a](a%20b.md#x) `[b](c.md)` [d](<a b.md>) [e](https://x)",
          "```text",
          "[x](x.md)",
          "```",
        ],
      ],
    ],
    [
      "_anchor_region",
      [
        [
          "<details>",
          "<summary>对应源码入口</summary>",
          "",
          "</details>",
          "<details>",
          "<summary>规则</summary>",
          "|a|",
        ],
        0,
        7,
      ],
    ],
  ];
  for (const [fn, args] of cases)
    assert.deepEqual(plain(doc[fn](...args)), oracle(fn, args), fn);
});

test("完整文档/折叠锚点/坏入口及CRLF行号与Python一致", () => {
  const folder = mkdtempSync(join(tmpdir(), "chain-doc-node-"));
  try {
    const rel = "docs/链路全景/业务/订单/02-支付.md";
    mkdirSync(join(folder, "docs/链路全景/业务/订单"), { recursive: true });
    const detail = render_detail(
      "子模块 1：扣款",
      ["调用 [N1.01]", "==> 能力：通知"],
      { "N1.01": ["服务层", ["方法：charge_payment()"]] },
    );
    const text =
      "# 模块 2：支付\n\n## 总览\n\n```text\n[1] 扣款\n```\n\n| 子模块 | 入口 | 详情 |\n| --- | --- | --- |\n| [1] 扣款 | a.py:3 `charge_payment()` | 完成 |\n| [2] 错误 | ../bad.py:1 | 拒绝 |\n\n## 子模块 1：扣款\n\n```text\n" +
      detail +
      "\n```\n\n<details>\n<summary>对应源码入口</summary>\n\n| 节点 | 文件入口 | 精确定位 |\n| --- | --- | --- |\n| N1.01 | a.py:3 | `charge_payment()` |\n| N1.01 | ../bad.py:3 | `bad()` |\n\n</details>\n\n<details>\n<summary>规则与字段</summary>\n| 节点 | 文件入口 | 精确定位 |\n| --- | --- | --- |\n| N1.01 | wrong.py:1 | `wrong()` |\n</details>\n";
    writeFileSync(join(folder, rel), text.replaceAll("\n", "\r\n"));
    assert.deepEqual(
      plain(doc.parse_doc(folder, rel)),
      oracle("parse_doc", [folder, rel]),
    );
    assert.deepEqual(doc.discover_docs(folder), [rel]);
    const parsed = doc.parse_doc(folder, rel);
    assert.equal(parsed.submodules[0].anchors.length, 1);
    assert.equal(
      parsed.issues.filter((x) => x.message.includes("文件入口不符合约定"))
        .length,
      2,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("原Python测试仓的所有文档结构与行号保持一致", () => {
  const samples = JSON.parse(
    readFileSync(
      new URL("./fixtures/baseline_chain_docs.json", import.meta.url),
      "utf8",
    ),
  );
  const folder = mkdtempSync(join(tmpdir(), "chain-doc-baseline-"));
  try {
    for (const [rel, sample] of Object.entries(samples)) {
      mkdirSync(join(folder, rel, ".."), { recursive: true });
      writeFileSync(join(folder, rel), sample.text);
    }
    for (const [rel, sample] of Object.entries(samples))
      assert.deepEqual(plain(doc.parse_doc(folder, rel)), sample.parsed, rel);
    assert.deepEqual(doc.discover_docs(folder), Object.keys(samples));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("发现路径按Python代码点排序且保留匹配的目录", () => {
  const folder = mkdtempSync(join(tmpdir(), "chain-doc-order-"));
  try {
    mkdirSync(join(folder, "docs/链路全景/dir.md"), { recursive: true });
    for (const name of ["a.md", "😀.md", "\ue000.md"])
      writeFileSync(join(folder, "docs/链路全景", name), "# 文档");
    assert.deepEqual(doc.discover_docs(folder), [
      "docs/链路全景/a.md",
      "docs/链路全景/dir.md",
      "docs/链路全景/\ue000.md",
      "docs/链路全景/😀.md",
    ]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("读文档先跟随软链再处理父目录，保持Path读取语义", () => {
  const folder = mkdtempSync(join(tmpdir(), "chain-doc-symlink-"));
  try {
    mkdirSync(join(folder, "target/deeper"), { recursive: true });
    writeFileSync(join(folder, "target/sample.md"), "# 正确\n");
    writeFileSync(join(folder, "sample.md"), "# 错误\n");
    symlinkSync(
      join(folder, "target/deeper"),
      join(folder, "alias"),
      "junction",
    );
    assert.equal(doc.parse_doc(folder, "alias/../sample.md").h1, "正确");
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("Windows路径双分隔符拒绝父目录并保留盘符与根路径语义", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", {
      ...descriptor,
      value: "win32",
    });
    const relative = win32.format({ dir: "folder\\..", base: "secret.py" });
    assert.equal(doc._locator(`${relative}:1`, "`foo()`", 7), null);
    assert.equal(doc._locator("..\\secret.py:1", "", 7), null);
    assert.equal(doc._locator("folder/..\\secret.py:1", "", 7), null);
    assert.deepEqual(doc._kind("docs\\链路全景\\业务\\订单\\02-支付.md"), [
      "模块",
      "业务",
      "订单",
      [2, "支付"],
    ]);
    assert.deepEqual(doc._kind("C:\\docs\\链路全景\\README.md"), [
      "未知",
      null,
      null,
      null,
    ]);
    assert.deepEqual(doc._kind("\\docs\\链路全景\\README.md"), [
      "未知",
      null,
      null,
      null,
    ]);
    // Python原条件仅拒绝/前缀或..组件，没有禁止Windows盘符及反斜杠根锚点。
    assert.equal(doc._locator("C:\\secret.py:1", "", 7).path, "C:\\secret.py");
    assert.equal(doc._locator("\\secret.py:1", "", 7).path, "\\secret.py");
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
});

test("POSIX路径保持反斜杠字面语义", () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", {
      ...descriptor,
      value: "linux",
    });
    assert.equal(doc._locator("..\\secret.py:1", "", 7).path, "..\\secret.py");
    assert.deepEqual(doc._kind("docs\\链路全景\\README.md"), [
      "未知",
      null,
      null,
      null,
    ]);
    assert.equal(doc._locator("../secret.py:1", "", 7), null);
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
});
