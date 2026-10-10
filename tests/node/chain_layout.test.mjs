import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  WIDTH_TOLERANCE,
  width_units,
  display_width,
  pad_display,
  place_at,
  render_detail,
  _wrap_field,
} from "../../scripts/chain_layout.mjs";
import { casefold } from "../../scripts/unicode_east_asian_width.mjs";

const fixtures = JSON.parse(
  readFileSync(
    new URL("./fixtures/chain_layout_oracles.json", import.meta.url),
    "utf8",
  ),
);
function oracle(fn, value) {
  return fixtures[JSON.stringify([fn, value])];
}

test("宽度按代码点及 Unicode15.1 W/F 分类，歧义符号仍是一格", () => {
  assert.equal(WIDTH_TOLERANCE, 0.5);
  assert.equal(display_width("中文a→…①"), 7.24);
  assert.equal(display_width("中".repeat(50)), 81);
  assert.equal(width_units("😀𠀀e\u0301"), 524);
  const expected = oracle("widths_all", null);
  assert.equal(expected.version, "15.1.0");
  const widths = Buffer.alloc(0x110000);
  for (let code = 0; code < widths.length; code++)
    widths[code] = Number(width_units(String.fromCodePoint(code)) === 162);
  assert.equal(
    createHash("sha256").update(widths).digest("hex"),
    expected.digest,
  );
});

test("填充与绝对列保留原空格、半格容差及 Python ties-to-even", () => {
  assert.ok(pad_display("字段：A B", 20).includes("A B"));
  assert.ok(
    Math.abs(display_width(place_at("| 中文", "|", 20).slice(0, -1)) - 20) <=
      0.5,
  );
  assert.throws(() => pad_display("中文".repeat(10), 10), {
    message: "内容超宽：32.4 > 10",
  });
  for (const [value, column, center] of [
    ["中", 5, true],
    ["a", 1.005, false],
    ["a", 1.015, false],
    ["", 0.495, false],
    ["", 1.495, true],
  ]) {
    assert.equal(
      pad_display(value, column, center),
      oracle("pad_display", [value, column, center]),
    );
  }
});

test("双栏原始输出与Python一致，Map卡片顺序不改左侧流程", () => {
  const left = ["起点 [N1.01]", "    |", "分支 [N1.02] [N1.03]", "结束"];
  const cards = {
    "N1.03": ["异步层", ["事件：third"]],
    "N1.01": ["页面层", ["方法：first()"]],
    "N1.02": ["应用层", ["方法：second()"]],
  };
  const expected = oracle("render_detail", ["分支", left, cards, 44, 48]);
  assert.equal(render_detail("分支", left, cards), expected);
  assert.equal(
    render_detail("分支", left, new Map(Object.entries(cards))),
    expected,
  );
  assert.ok(
    expected
      .split("\n")
      .every((row) => Math.abs(display_width(row) - 99) <= 0.5),
  );
});

test("安全续行保留完整入口，标识符及节点错误明确拒绝", () => {
  const fields = [
    "失败：" + "中".repeat(21) + "原因：失效",
    "文件：server/applications/orders/long_method_identifier_for_test()",
    "A B / 中 文 → 下一步",
  ];
  for (const field of fields)
    assert.deepEqual(_wrap_field(field, 40), oracle("_wrap_field", field));
  assert.throws(() => render_detail("缺卡", ["调用 [N1.01]"], {}), {
    message: "左栏节点缺少卡片：['N1.01']",
  });
  assert.throws(
    () => render_detail("多卡", ["结束"], { "N1.01": ["应用层", []] }),
    { message: "右栏卡片无对应节点：['N1.01']" },
  );
  assert.throws(
    () =>
      render_detail("重复", ["[N1.01] [N1.01]"], { "N1.01": ["应用层", []] }),
    { message: "左栏节点编号重复" },
  );
  assert.throws(() => render_detail("超宽", [], {}, 52), {
    message: "双栏超宽或过窄：整图不得超过 100 列（当前 107）",
  });
  assert.throws(
    () =>
      _wrap_field("a_single_identifier_far_too_long_to_fit_in_one_card()", 40),
    /标识符无法安全续行/,
  );
});

test("完整casefold身份与Python15.1固定oracle一致", () => {
  assert.equal(casefold("Straße İ Σςﬃ K 𐐀"), "strasse i\u0307 σσffi k 𐐨");
  const changes = [];
  for (let code = 0; code < 0x110000; code++) {
    const char = String.fromCodePoint(code),
      folded = casefold(char);
    if (folded !== char) changes.push([code, folded]);
  }
  assert.equal(
    createHash("sha256").update(JSON.stringify(changes)).digest("hex"),
    fixtures.casefold_sha,
  );
});
