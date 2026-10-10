/** 链路详图的百分之一格显示宽度与双栏生成，保持原Python输出字节。 */
import {
  WIDE_RANGES,
  WORD_RANGES,
  DECIMAL_ZEROS,
} from "./unicode_east_asian_width.mjs";
export const WIDTH_TOLERANCE = 0.5;
export const DETAIL_LEFT = 48;
export const DETAIL_RIGHT = 44;

function is_wide(code) {
  let low = 0,
    high = WIDE_RANGES.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = WIDE_RANGES[middle];
    if (code < start) high = middle - 1;
    else if (code > end) low = middle + 1;
    else return true;
  }
  return false;
}
export function width_units(value) {
  let total = 0;
  for (const char of value) total += is_wide(char.codePointAt(0)) ? 162 : 100;
  return total;
}
export function display_width(value) {
  return width_units(value) / 100;
}

// 共享Python Unicode15.1字符合同，避免JS \s、\d及UTF16索引差异。
export const WHITE_CHARS =
  "\\t-\\r\\x1c-\\x20\\x85\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export const SPACE = `[${WHITE_CHARS}]`;
export const NONSPACE = `[^${WHITE_CHARS}]`;
export const WORD_CHARS = WORD_RANGES.map(
  ([start, end]) => `\\u{${start.toString(16)}}-\\u{${end.toString(16)}}`,
).join("");
export const DIGIT = `[${DECIMAL_ZEROS.map((code) => `\\u{${code.toString(16)}}-\\u{${(code + 9).toString(16)}}`).join("")}]`;
export function strip(value) {
  return value.replace(new RegExp(`^${SPACE}+|${SPACE}+$`, "gu"), "");
}
export function lstrip(value) {
  return value.replace(new RegExp(`^${SPACE}+`, "u"), "");
}
export function rstrip(value) {
  return value.replace(new RegExp(`${SPACE}+$`, "u"), "");
}
export function decimal_int(value) {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0);
    const zero = DECIMAL_ZEROS.find(
      (start) => code >= start && code < start + 10,
    );
    out += zero === undefined ? char : String(code - zero);
  }
  return Number(out);
}
function round_even(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  return fraction === 0.5
    ? lower % 2 === 0
      ? lower
      : lower + 1
    : Math.round(value);
}
export function _spaces_to(prefix, column) {
  const gap = round_even(column * 100) - width_units(prefix);
  if (gap < -round_even(WIDTH_TOLERANCE * 100)) {
    const width = display_width(prefix);
    const rendered = Number.isInteger(width) ? width.toFixed(1) : String(width);
    throw new Error(`内容超宽：${rendered} > ${column}`);
  }
  return Math.max(0, Math.floor((gap + 50) / 100));
}
export function pad_display(value, columns, center = false) {
  const spaces = _spaces_to(value, columns);
  if (center) {
    const left = Math.floor(spaces / 2);
    return " ".repeat(left) + value + " ".repeat(spaces - left);
  }
  return value + " ".repeat(spaces);
}
export function place_at(prefix, value, column) {
  return prefix + " ".repeat(_spaces_to(prefix, column)) + value;
}
export function _wrap_field(value, width) {
  const pieces = [];
  let remaining = value;
  const limit = width * 100 + round_even(WIDTH_TOLERANCE * 100);
  const ascii_atom = /^[A-Za-z0-9_$.()]$/u;
  while (width_units(remaining) > limit - (pieces.length ? 200 : 0)) {
    const candidates = [];
    const available = limit - (pieces.length ? 200 : 0);
    const chars = Array.from(remaining);
    let units = 0;
    for (let index = 1; index < chars.length; index++) {
      units += width_units(chars[index - 1]);
      if (units > available) break;
      const before = chars[index - 1],
        after = chars[index];
      if (
        " /：，；、→".includes(before) ||
        (before && !ascii_atom.test(before) && !ascii_atom.test(after))
      )
        candidates.push(index);
    }
    if (!candidates.length)
      throw new Error(
        `卡片标识符无法安全续行，请缩短描述并在源码表保留完整入口：${value}`,
      );
    const cut = candidates.at(-1);
    pieces.push(
      (pieces.length ? "  " : "") + rstrip(chars.slice(0, cut).join("")),
    );
    remaining = lstrip(chars.slice(cut).join(""));
  }
  if (remaining) pieces.push((pieces.length ? "  " : "") + remaining);
  return pieces;
}
function python_list(items) {
  return `[${items
    .sort()
    .map((value) => `'${value}'`)
    .join(", ")}]`;
}
export function render_detail(
  title,
  left,
  cards,
  right_width = DETAIL_RIGHT,
  left_width = DETAIL_LEFT,
) {
  const total = left_width + right_width + 7;
  if (left_width < 20 || right_width < 20 || total > 100)
    throw new Error(`双栏超宽或过窄：整图不得超过 100 列（当前 ${total}）`);
  const entries =
    cards instanceof Map ? [...cards.entries()] : Object.entries(cards);
  const split_col = left_width + 3,
    card_col = split_col + 2;
  const border = "+" + "-".repeat(total - 2) + "+";
  const divider =
    "+" + "-".repeat(split_col - 1) + "+" + "-".repeat(right_width + 2) + "+";
  function row(left_text, right_text) {
    if (
      width_units(left_text) >
      left_width * 100 + round_even(WIDTH_TOLERANCE * 100)
    )
      throw new Error(`左栏内容超宽，请将说明另起一行：${left_text}`);
    let prefix = place_at("| " + left_text, "|", split_col);
    prefix = place_at(prefix, right_text, card_col);
    if (right_text.startsWith("| "))
      prefix = place_at(prefix, "|", card_col + right_width - 1);
    return place_at(prefix, "|", total - 1);
  }
  function card_row(content) {
    if (
      width_units(content) >
      (right_width - 4) * 100 + round_even(WIDTH_TOLERANCE * 100)
    )
      throw new Error(`卡片内容超宽，请缩短描述：${content}`);
    return "| " + content;
  }
  const node_re = new RegExp(`\\[(N${DIGIT}+\\.${DIGIT}{2})\\]`, "gu");
  const nodes = left.flatMap((item) =>
    [...item.matchAll(node_re)].map((match) => match[1]),
  );
  if (nodes.length !== new Set(nodes).size) throw new Error("左栏节点编号重复");
  const keys = new Set(entries.map(([node]) => node));
  const node_set = new Set(nodes);
  const missing = [...node_set].filter((node) => !keys.has(node));
  const extra = [...keys].filter((node) => !node_set.has(node));
  if (missing.length)
    throw new Error(`左栏节点缺少卡片：${python_list(missing)}`);
  if (extra.length)
    throw new Error(`右栏卡片无对应节点：${python_list(extra)}`);
  const right = [];
  const rule = "+" + "-".repeat(right_width - 2) + "+";
  for (const [node, [layer, fields]] of entries) {
    if (right.length) right.push("");
    right.push(rule, card_row(`[${node}] ${layer}`));
    for (const field of fields)
      right.push(..._wrap_field(field, right_width - 4).map(card_row));
    right.push(rule);
  }
  const rows = [
    border,
    "|" + pad_display(title, total - 2, true) + "|",
    border,
    row("业务流程与分支", "实现分层与代码入口"),
    divider,
  ];
  for (let index = 0; index < Math.max(left.length, right.length); index++)
    rows.push(row(left[index] ?? "", right[index] ?? ""));
  rows.push(divider);
  return rows.join("\n");
}
