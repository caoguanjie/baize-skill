/** 链路全景Markdown共享解析结构，保持Python字段、行号及拒绝行为。 */
import fs from "node:fs";
import path from "node:path";
import {
  display_width,
  width_units,
  SPACE,
  NONSPACE,
  WHITE_CHARS,
  WORD_CHARS,
  DIGIT,
  strip,
  lstrip,
  rstrip,
  decimal_int,
} from "./chain_layout.mjs";
import {
  read_text,
  split_lines,
  compare_text,
  resolve_path,
} from "./chain_utils.mjs";
export { display_width, width_units };
export const CHAIN_DIR = "docs/链路全景";
export const BUILTIN_LAYERS = ["能力"];
export const CARD_FIELDS = [
  "文件",
  "按钮",
  "自动",
  "判断",
  "方法",
  "桥接",
  "插件",
  "前端",
  "接口",
  "依赖",
  "表",
  "缓存",
  "事件",
  "外部",
  "跳转",
  "成功",
  "失败",
  "并发",
  "动作",
];
export const TYPE_WORDS = ["表", "接口", "事件", "缓存", "外部", "能力"];
export const ACTION_WORDS = ["读写", "发布", "消费", "调用", "读", "写"];
export const MAX_WIDTH = 100;
const word = WORD_CHARS;
const node_pattern = `N${DIGIT}+\\.${DIGIT}{2}`;
const jump_pattern = `(?<![=])(?<arrow>==>|=>)${SPACE}*([^|]+?)(?=${SPACE}{2,}|\\||$)`;
function re(source, flags = "u") {
  return new RegExp(source, flags);
}
function parts(value) {
  // Windows的两种分隔符及盘符/根锚点需保留；POSIX反斜杠仍是普通文件名字符。
  if (process.platform === "win32") {
    const root = path.win32.parse(value).root;
    const items = value
      .slice(root.length)
      .split(/[\\/]/u)
      .filter((item) => item && item !== ".");
    return root ? [root.replaceAll("/", "\\"), ...items] : items;
  }
  const items = value.split("/").filter((item) => item && item !== ".");
  return value.startsWith("/") ? ["/", ...items] : items;
}

export function same_display_column(first, second) {
  const lower = Math.max(first - 50, second - 50),
    upper = Math.min(first + 50, second + 50);
  return Math.floor((lower + 99) / 100) <= Math.floor(upper / 100);
}
export function split_at_column(line, col) {
  const chars = Array.from(line);
  let best = null,
    units = 0;
  for (let index = 0; index < chars.length; index++) {
    const gap = Math.abs(units - col * 100);
    if (chars[index] === "|" && gap <= 50 && (!best || gap < best[0]))
      best = [gap, index];
    units += width_units(chars[index]);
  }
  if (!best) return [line, ""];
  return [chars.slice(0, best[1]).join(""), chars.slice(best[1]).join("")];
}
export function split_table_row(line) {
  const cells = [];
  let buf = "",
    quote_length = 0,
    pos = 0;
  while (pos < line.length) {
    const char = line[pos];
    if (char === "\\" && pos + 1 < line.length && line[pos + 1] === "|") {
      buf += "|";
      pos += 2;
      continue;
    }
    if (char === "`") {
      let end = pos;
      while (end < line.length && line[end] === "`") end++;
      const count = end - pos;
      if (quote_length === 0) quote_length = count;
      else if (quote_length === count) quote_length = 0;
      buf += line.slice(pos, end);
      pos = end;
      continue;
    }
    if (char === "|" && quote_length === 0) {
      cells.push(strip(buf));
      buf = "";
    } else buf += char;
    pos++;
  }
  cells.push(strip(buf));
  if (lstrip(line).startsWith("|")) cells.shift();
  if (rstrip(line).endsWith("|")) cells.pop();
  return cells;
}

export class Issue {
  constructor(doc, line, where, level, message) {
    Object.assign(this, { doc, line, where, level, message });
    Object.freeze(this);
  }
  render() {
    return `${this.doc}:${this.line} ${this.where} ${this.level}：${this.message}`;
  }
}
export class Token {
  constructor(
    kind,
    value,
    type_word = null,
    action = null,
    description = null,
  ) {
    Object.assign(this, { kind, value, type_word, action, description });
    Object.freeze(this);
  }
}
export class Locator {
  constructor(path, line, tokens, doc_line) {
    Object.assign(this, { path, line, tokens, doc_line });
  }
}
export class AnchorRow extends Locator {
  constructor(path, line, tokens, doc_line, node = "") {
    super(path, line, tokens, doc_line);
    this.node = node;
  }
}
export class ListRow {
  constructor(number, name, entry, doc_line, detail = null) {
    Object.assign(this, { number, name, entry, doc_line, detail });
  }
}
export class Card {
  constructor(node, layer, fields, calls, doc_line) {
    Object.assign(this, { node, layer, fields, calls, doc_line });
  }
}
export class Jump {
  constructor(raw, kind, target, sub, doc_line, continuation = null) {
    Object.assign(this, { raw, kind, target, sub, doc_line, continuation });
  }
}
export class Diagram {
  constructor(start_line, lines, nodes, cards, jumps, split_col) {
    Object.assign(this, { start_line, lines, nodes, cards, jumps, split_col });
  }
}
export class Overview {
  constructor(line, diagram, nodes, list_kind, rows) {
    Object.assign(this, { line, diagram, nodes, list_kind, rows });
  }
}
export class SubModule {
  constructor(number, name, line, diagram, anchors) {
    Object.assign(this, { number, name, line, diagram, anchors });
  }
}
export class ChainDoc {
  constructor(
    path,
    kind,
    area,
    business,
    module,
    h1,
    h1_line,
    overview,
    submodules,
    links,
    lines,
    issues,
  ) {
    Object.assign(this, {
      path,
      kind,
      area,
      business,
      module,
      h1,
      h1_line,
      overview,
      submodules,
      links,
      lines,
      issues,
    });
  }
}

export function classify_tokens(cell) {
  const tokens = [];
  let end = 0;
  for (const match of cell.matchAll(/`([^`]+)`/gu)) {
    const before = rstrip(cell.slice(end, match.index)),
      value = match[1];
    const type_word = TYPE_WORDS.find((word) => before.endsWith(word)) ?? null;
    const after = cell.slice(match.index + match[0].length);
    const action_match = after.match(
      re(`^${SPACE}*(${ACTION_WORDS.join("|")})(?![${word}])`),
    );
    if (type_word) {
      const remainder = action_match
        ? after.slice(action_match[0].length)
        : after;
      const description_match =
        type_word === "表"
          ? re(`^${SPACE}*（([^（）]+)）`).exec(remainder)
          : null;
      tokens.push(
        new Token(
          "类型",
          value,
          type_word,
          action_match?.[1] ?? null,
          description_match ? strip(description_match[1]) : null,
        ),
      );
    } else if (
      [".", "#", "data-testid="].some((prefix) => value.startsWith(prefix))
    )
      tokens.push(new Token("选择器", value));
    else if (
      /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*(?:\(\))?$/u.test(
        value,
      )
    )
      tokens.push(new Token("符号", value));
    else tokens.push(new Token("说明", value));
    end = match.index + match[0].length;
  }
  return tokens;
}
export function discover_docs(root) {
  const folder = path.join(root, CHAIN_DIR);
  if (!fs.existsSync(folder)) return [];
  const found = [];
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.name.endsWith(".md"))
        found.push(path.relative(root, file).split(path.sep).join("/"));
      if (item.isDirectory()) visit(file);
    }
  }
  visit(folder);
  return found.sort(compare_text);
}
export function parse_jumps(line, doc_line) {
  const result = [];
  for (const match of line.matchAll(re(jump_pattern, "gu"))) {
    const raw = strip(match[2]);
    let kind = null,
      target = raw,
      sub = null,
      found;
    if (
      (found = re(
        `^子模块${SPACE}+(${DIGIT}+)(?:：([^${WHITE_CHARS}|]+))?$`,
      ).exec(raw))
    ) {
      kind = "子模块";
      target = found[1];
      sub = found[2] ?? null;
    } else if ((found = re(`^子模块${SPACE}*(${DIGIT}+)$`).exec(raw))) {
      kind = "子模块";
      target = found[1];
    } else if (
      (found = re(
        `^模块：([^${WHITE_CHARS}|]+)(?: / ([^${WHITE_CHARS}|]+))?$`,
      ).exec(raw))
    ) {
      kind = "模块";
      target = found[1];
      sub = found[2] ?? null;
    } else if (
      (found = re(
        `^模块${SPACE}+(${DIGIT}+)(?:：([^${WHITE_CHARS}|]+))?$`,
      ).exec(raw))
    ) {
      kind = "模块编号";
      target = found[1];
      sub = found[2] ?? null;
    } else if ((found = re(`^(业务|能力)：([^${WHITE_CHARS}|]+)$`).exec(raw))) {
      kind = found[1];
      target = found[2];
    }
    if (kind === null && match.groups.arrow === "=>") continue;
    result.push(new Jump(raw, kind, target, sub, doc_line));
  }
  return result;
}
export function parse_diagram(lines, start_line, detail) {
  let split_col = null;
  if (detail) {
    for (const line of lines) {
      if (
        line.includes("业务流程与分支") &&
        line.includes("实现分层与代码入口")
      ) {
        const bars = [];
        let prefix = "";
        for (const char of line) {
          if (char === "|") bars.push(width_units(prefix));
          prefix += char;
        }
        split_col = bars.length >= 2 ? Math.floor((bars[1] + 50) / 100) : null;
        break;
      }
    }
  }
  const nodes = [],
    cards = [],
    jumps = [];
  let active = null;
  for (let offset = 0; offset < lines.length; offset++) {
    const line = lines[offset],
      number = start_line + offset;
    const [left, right] =
      detail && split_col ? split_at_column(line, split_col) : [line, ""];
    if (detail)
      for (const found of left.matchAll(re(`\\[(${node_pattern})\\]`, "gu")))
        nodes.push([found[1], number]);
    let jump_line = left;
    if (detail && offset + 1 < lines.length) {
      const next_left = split_col
        ? split_at_column(lines[offset + 1], split_col)[0]
        : lines[offset + 1];
      for (const match of [
        ...left.matchAll(re(jump_pattern, "dgu")),
      ].reverse()) {
        const raw = strip(match[2]);
        if (!re(`^(?:子模块${SPACE}*${DIGIT}+：|模块：)`).test(raw)) continue;
        const column = width_units(left.slice(0, match.index));
        const candidates = [
          ...next_left.matchAll(re(`[^${WHITE_CHARS}|=+\\[\\]v-]+`, "gu")),
        ].filter((item) =>
          same_display_column(
            width_units(next_left.slice(0, item.index)),
            column,
          ),
        );
        if (candidates.length === 1) {
          const end = match.indices[2][1];
          jump_line =
            jump_line.slice(0, end) + candidates[0][0] + jump_line.slice(end);
        }
      }
    }
    const parsed = parse_jumps(left, number),
      extended = parse_jumps(jump_line, number);
    if (parsed.length === extended.length)
      for (let index = 0; index < parsed.length; index++)
        if (parsed[index].raw !== extended[index].raw)
          parsed[index].continuation = extended[index].raw;
    jumps.push(...parsed);
    if (!detail) continue;
    const title = re(`\\[(${node_pattern})\\]${SPACE}+(${NONSPACE}+)`).exec(
      right,
    );
    if (title) {
      active = new Card(title[1], title[2], [], [], number);
      cards.push(active);
    } else if (active && strip(right).startsWith("+")) {
      /* 横线不结束卡片；后续空白才结束。 */
    } else if (active && ["", "|", "| |"].includes(strip(right))) active = null;
    if (active && !title) {
      const content_match = re(`^\\| \\| (.*?) \\|${SPACE}*\\|$`).exec(right);
      if (content_match) {
        const content = content_match[1];
        const field_match = re(`^([^${WHITE_CHARS}：]{1,8})：`).exec(content);
        if (field_match) active.fields.push([field_match[1], number]);
        for (const call of content.matchAll(
          re(`\\.?[A-Za-z_$][${word}$.]*\\(\\)`, "gu"),
        ))
          active.calls.push(call[0].replace(/^\.+/u, ""));
      }
    }
  }
  return new Diagram(start_line, lines, nodes, cards, jumps, split_col);
}
export function _kind(rel) {
  const list = parts(rel),
    prefix = parts(CHAIN_DIR);
  if (!prefix.every((item, index) => list[index] === item))
    return ["未知", null, null, null];
  const rest = list.slice(prefix.length);
  if (rest.length === 1 && rest[0] === "README.md")
    return ["顶层", null, null, null];
  if (
    rest.length === 2 &&
    ["业务", "能力"].includes(rest[0]) &&
    rest[1].endsWith(".md") &&
    rest[1] !== "README.md"
  )
    return [
      "单文件",
      rest[0],
      rest[0] === "业务" ? path.posix.parse(rest[1]).name : null,
      null,
    ];
  if (rest.length === 3 && rest[0] === "业务") {
    if (["README.md", "总览.md"].includes(rest[2]))
      return ["业务全景", "业务", rest[1], null];
    const found = re(`^(${DIGIT}{2})-(.+)\\.md$`).exec(rest[2]);
    if (found)
      return ["模块", "业务", rest[1], [decimal_int(found[1]), found[2]]];
  }
  return ["未知", null, null, null];
}
export function _blocks(lines, start, end) {
  const result = [];
  let index = start;
  while (index < end) {
    if (strip(lines[index]) === "```text") {
      let close = index + 1;
      while (close < end && strip(lines[close]) !== "```") close++;
      result.push([index + 2, lines.slice(index + 1, close)]);
      index = close;
    }
    index++;
  }
  return result;
}
export function _table(lines, start, end) {
  for (let index = start; index < end; index++) {
    if (lstrip(lines[index]).startsWith("|")) {
      const table = [];
      let cursor = index;
      while (cursor < end && lstrip(lines[cursor]).startsWith("|"))
        table.push(split_table_row(lines[cursor++]));
      return [index + 1, table];
    }
  }
  return null;
}
export function _locator(cell, detail, doc_line) {
  const found = re(
    `([^${WHITE_CHARS}|\x60]+?)(?::(${DIGIT}+))?(?=${SPACE}|$)`,
  ).exec(strip(cell));
  if (!found) return null;
  const file = found[1];
  if (!file || file.startsWith("/") || parts(file).includes("..")) return null;
  return new Locator(
    file,
    found[2] ? decimal_int(found[2]) : null,
    classify_tokens(detail),
    doc_line,
  );
}
function unquote(value) {
  // Python unquote保留不完整百分号，非法UTF8使用替换字符，而不整段抛错。
  return value.replace(/(?:%[0-9a-fA-F]{2})+/gu, (encoded) =>
    Buffer.from(
      encoded
        .match(/%([0-9a-fA-F]{2})/gu)
        .map((part) => Number.parseInt(part.slice(1), 16)),
    ).toString("utf8"),
  );
}
export function _links(lines) {
  const found = [];
  let fenced = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (strip(line).startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const clean = line.replace(/`[^`]*`/gu, "");
    for (const match of clean.matchAll(
      re(`\\[[^\\]]*\\]\\((<[^>]+>|[^)${WHITE_CHARS}]+)\\)`, "gu"),
    )) {
      const target = match[1].replace(/^[<>]+|[<>]+$/gu, "");
      if (
        ["http://", "https://", "mailto:", "#"].some((prefix) =>
          target.startsWith(prefix),
        )
      )
        continue;
      found.push([unquote(target.split("#", 1)[0]), index + 1]);
    }
  }
  return found;
}
export function _anchor_region(lines, start, end) {
  let index = start;
  while (index < end) {
    const line = strip(lines[index]);
    if (line === "### 对应源码入口") {
      let stop = end;
      for (let offset = index + 1; offset < end; offset++)
        if (
          lines[offset].startsWith("### ") ||
          strip(lines[offset]) === "<details>"
        ) {
          stop = offset;
          break;
        }
      return [index + 1, stop];
    }
    if (line === "<details>") {
      let close = end;
      for (let offset = index + 1; offset < end; offset++)
        if (strip(lines[offset]) === "</details>") {
          close = offset;
          break;
        }
      let summary = null;
      for (let offset = index + 1; offset < close; offset++)
        if (strip(lines[offset])) {
          summary = offset;
          break;
        }
      if (
        summary !== null &&
        strip(lines[summary]) === "<summary>对应源码入口</summary>"
      )
        return [summary + 1, close];
      index = close;
    }
    index++;
  }
  return null;
}
export function parse_doc(root, rel) {
  const lines = split_lines(read_text(resolve_path(root, rel)));
  const [kind, area, business, module] = _kind(rel);
  const first = lines.findIndex((line) => line.startsWith("# "));
  const h1_match = first < 0 ? [1, ""] : [first + 1, lines[first].slice(2)];
  const issues =
    kind === "未知"
      ? [new Issue(rel, 1, "文档", "错误", "文件位置不符合约定")]
      : [];
  let overview = null;
  const submodules = [];
  const headers = lines.flatMap((line, index) =>
    line.startsWith("## ") ? [[index, line]] : [],
  );
  for (let position = 0; position < headers.length; position++) {
    const [index, header] = headers[position];
    const end = headers[position + 1]?.[0] ?? lines.length;
    if (header === "## 总览") {
      const blocks = _blocks(lines, index + 1, end);
      const diagram = blocks.length
        ? parse_diagram(blocks[0][1], blocks[0][0], false)
        : null;
      const nodes = [];
      if (diagram)
        for (let offset = 0; offset < diagram.lines.length; offset++)
          for (const found of diagram.lines[offset].matchAll(
            re(`\\[(${DIGIT}+)\\] (${NONSPACE}+)`, "gu"),
          )) {
            const item = [
              decimal_int(found[1]),
              found[2],
              diagram.start_line + offset,
            ];
            if (
              !nodes.some((node) => node[0] === item[0] && node[1] === item[1])
            )
              nodes.push(item);
          }
      const table = _table(
        lines,
        blocks.length ? blocks[0][0] + blocks[0][1].length + 1 : index + 1,
        end,
      );
      let list_kind = null;
      const rows = [];
      if (table) {
        const [head_line, cells] = table;
        list_kind = cells[0]?.[0] ?? null;
        for (let offset = 2; offset < cells.length; offset++) {
          const row = cells[offset];
          const found = row.length
            ? re(`^\\[(${DIGIT}+)\\] (${NONSPACE}+)`).exec(row[0])
            : null;
          if (found) {
            const entry_index = cells[0].indexOf("入口");
            const entry =
              entry_index >= 0 && row.length > entry_index
                ? _locator(
                    row[entry_index],
                    row[entry_index],
                    head_line + offset,
                  )
                : null;
            if (entry_index >= 0 && entry === null)
              issues.push(
                new Issue(
                  rel,
                  head_line + offset,
                  `${list_kind || "清单"} ${found[1]}`,
                  "错误",
                  `文件入口不符合约定：${row[entry_index] ?? ""}`,
                ),
              );
            const detail_index = cells[0].indexOf("详情");
            const detail =
              detail_index >= 0 && row.length > detail_index
                ? row[detail_index]
                : null;
            rows.push(
              new ListRow(
                decimal_int(found[1]),
                found[2],
                entry,
                head_line + offset,
                detail,
              ),
            );
          }
        }
      }
      overview = new Overview(index + 1, diagram, nodes, list_kind, rows);
    } else {
      const found = re(`^## 子模块 (${DIGIT}+)：(.+)$`).exec(header);
      if (!found) continue;
      const blocks = _blocks(lines, index + 1, end);
      const diagram = blocks.length
        ? parse_diagram(blocks[0][1], blocks[0][0], true)
        : null;
      const anchor_region = _anchor_region(lines, index + 1, end);
      const anchors = [];
      if (anchor_region !== null) {
        const table = _table(lines, ...anchor_region);
        if (table) {
          const [head_line, cells] = table;
          if (
            JSON.stringify(cells[0]) !==
            JSON.stringify(["节点", "文件入口", "精确定位"])
          )
            issues.push(
              new Issue(
                rel,
                head_line,
                `子模块 ${found[1]}`,
                "错误",
                "锚点表表头应为：节点 | 文件入口 | 精确定位",
              ),
            );
          for (let offset = 2; offset < cells.length; offset++) {
            const row = cells[offset];
            if (row.length >= 3) {
              const loc = _locator(row[1], row[2], head_line + offset);
              if (loc)
                anchors.push(
                  new AnchorRow(
                    loc.path,
                    loc.line,
                    loc.tokens,
                    loc.doc_line,
                    row[0],
                  ),
                );
              else
                issues.push(
                  new Issue(
                    rel,
                    head_line + offset,
                    row[0],
                    "错误",
                    `文件入口不符合约定：${row[1]}`,
                  ),
                );
            }
          }
        }
      } else
        issues.push(
          new Issue(
            rel,
            index + 1,
            `子模块 ${found[1]}`,
            "错误",
            "缺少：对应源码入口",
          ),
        );
      submodules.push(
        new SubModule(
          decimal_int(found[1]),
          found[2],
          index + 1,
          diagram,
          anchors,
        ),
      );
    }
  }
  if (["单文件", "业务全景", "模块"].includes(kind) && overview === null)
    issues.push(new Issue(rel, h1_match[0], "文档", "错误", "缺少：总览图"));
  return new ChainDoc(
    rel,
    kind,
    area,
    business,
    module,
    h1_match[1],
    h1_match[0],
    overview,
    submodules,
    _links(lines),
    lines,
    issues,
  );
}
