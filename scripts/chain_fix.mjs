/** 只修正文档中漂移的行号，并从业务锚点重建交叉表。 */
import fs from "node:fs";
import path from "node:path";
import { CHAIN_DIR, Issue } from "./chain_doc.mjs";
import { first_locatable, token_line_matches } from "./chain_check.mjs";
import { split_lines, resolve_path } from "./chain_utils.mjs";
import { WORD_CHARS, SPACE } from "./chain_layout.mjs";
export const CROSS_START = "<!-- chain:cross-table:start -->",
  CROSS_END = "<!-- chain:cross-table:end -->";
export const TYPE_ORDER = ["能力", "表", "接口", "事件", "缓存", "外部"],
  ACTION_ORDER = ["读写", "读", "写", "发布", "消费", "调用"];
const compare_text = (a, b) => {
  const x = Array.from(a),
    y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
};
const last_symbol = (value) => value.replace(/\(\)$/, "").split(".").at(-1);
const escape_regex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const strict_text = (file) =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    fs.readFileSync(file),
  );
const is_file = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    if (["ENOENT", "ENOTDIR"].includes(e.code)) return false;
    throw e;
  }
};
export function _actions(words) {
  if (![...words].some(Boolean)) return "用";
  const values = new Set(
    [...words].filter((v) => v !== null && v !== undefined),
  );
  if (values.has("读写") || (values.has("读") && values.has("写"))) {
    values.delete("读");
    values.delete("写");
    values.add("读写");
  }
  return ACTION_ORDER.filter((v) => values.has(v)).join("、");
}
export function build_cross_table(docs) {
  const businesses = [
      ...new Set(
        docs
          .filter((d) => d.area === "业务" && d.business)
          .map((d) => d.business),
      ),
    ].sort(compare_text),
    usage = new Map(),
    descriptions = new Map();
  for (const doc of docs) {
    if (doc.area !== "业务" || !doc.business) continue;
    for (const sub of doc.submodules)
      for (const anchor of sub.anchors)
        for (const token of anchor.tokens) {
          if (token.kind !== "类型" || !TYPE_ORDER.includes(token.type_word))
            continue;
          const key = JSON.stringify([token.type_word, token.value]);
          if (!usage.has(key)) usage.set(key, new Map());
          const by = usage.get(key);
          if (!by.has(doc.business)) by.set(doc.business, new Set());
          by.get(doc.business).add(token.action ?? null);
          if (token.type_word === "表" && token.description) {
            if (!descriptions.has(token.value))
              descriptions.set(token.value, new Set());
            descriptions.get(token.value).add(token.description);
          }
        }
  }
  const escape = (v) => v.replaceAll("|", "\\|"),
    output = [
      "| 类型 | 名称 | " + businesses.map(escape).join(" | ") + " |",
      "| --- | --- | " + businesses.map(() => "---").join(" | ") + " |",
    ];
  const keys = [...usage.keys()]
    .map((k) => JSON.parse(k))
    .sort(
      (a, b) =>
        TYPE_ORDER.indexOf(a[0]) - TYPE_ORDER.indexOf(b[0]) ||
        compare_text(a[1], b[1]),
    );
  for (const [kind, name] of keys) {
    const by = usage.get(JSON.stringify([kind, name]));
    if (kind !== "能力" && by.size < 2) continue;
    let label = name;
    if (kind === "表") {
      const names = [...(descriptions.get(name) || [])].sort(compare_text);
      if (names.length === 1) label = `${name}（${names[0]}）`;
      else if (names.length > 1)
        label = `${name}（中文说明冲突，需核对：${names.join("、")}）`;
    }
    output.push(
      "| " +
        [
          kind,
          escape(label),
          ...businesses.map((b) => (by.has(b) ? _actions(by.get(b)) : "-")),
        ].join(" | ") +
        " |",
    );
  }
  return output.join("\n") + "\n";
}
export function write_cross_table(root, docs) {
  const readme = resolve_path(root, CHAIN_DIR + "/README.md");
  if (!is_file(readme)) return false;
  const text = strict_text(readme);
  if (!text.includes(CROSS_START) || !text.includes(CROSS_END)) return false;
  const start = text.indexOf(CROSS_START) + CROSS_START.length,
    end = text.indexOf(CROSS_END, start);
  if (end < 0) throw new Error("substring not found");
  const wanted = "\n" + build_cross_table(docs);
  if (text.slice(start, end) === wanted) return false;
  fs.writeFileSync(
    readme,
    text.slice(0, start) + wanted + text.slice(end),
    "utf8",
  );
  return true;
}
export function _code_lines(lines) {
  const pattern =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|\#[^\n]*|"{3}[\s\S]*?"{3}|'{3}[\s\S]*?'{3}|@"(?:""|[^"])*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g;
  return lines
    .join("\n")
    .replace(pattern, (match) => match.replace(/[^\n]/g, " "))
    .split("\n");
}
export function _definition_lines(lines, symbol) {
  lines = _code_lines(lines);
  const e = escape_regex(symbol),
    patterns = [
      `\\b(?:async\\s+)?def\\s+${e}\\b`,
      `\\b(?:async\\s+)?function\\s*\\*?\\s*${e}\\b`,
      `\\bclass\\s+${e}\\b`,
      `\\bfun\\s+${e}\\b`,
      `\\bfunc\\s+${e}\\b`,
      `\\bfunc\\s*\\([^)]*\\)\\s*${e}\\b`,
      `\\b(?:const|let|var)\\s+${e}\\s*=`,
      `^\\s*(?:(?:public|private|protected|static|async|override|get|set)\\s+)*${e}\\s*\\(`,
      `^\\s*(?!(?:return|new|await|throw|else|elif|if|while|for|foreach|switch|not|and|or|in|is|assert|del|yield|case|goto|echo|print|lambda)\\b)(?:@[\\w.]+(?:\\([^)]*\\))?\\s*|\\[[^\\]]*\\]\\s*)*(?:(?:public|private|protected|internal|static|final|abstract|synchronized|async|override|virtual|sealed|extern|unsafe|partial|native)\\s+)*(?:<[^>]+>\\s+)?[\\w<>\\[\\],.?]+(?:\\s*,\\s*[\\w<>\\[\\],.?]+)*\\s+${e}\\s*\\(`,
    ];
  const word = "[" + WORD_CHARS + "]",
    boundary = `(?:(?<=${word})(?!${word})|(?<!${word})(?=${word}))`;
  const regexes = patterns.map(
    (p) =>
      new RegExp(
        p
          .replaceAll("\\b", boundary)
          .replaceAll("[\\w", "[" + WORD_CHARS)
          .replaceAll("\\w", word)
          .replaceAll("\\s", SPACE),
        "u",
      ),
  );
  return lines.flatMap((line, i) =>
    regexes.some((r) => r.test(line)) ? [i + 1] : [],
  );
}
export function* _locators(doc) {
  for (const sub of doc.submodules)
    for (const anchor of sub.anchors) yield [anchor, anchor.node];
  if (doc.overview) {
    const label = doc.overview.list_kind || "清单";
    for (const row of doc.overview.rows)
      if (row.entry) yield [row.entry, `${label} ${row.number}`];
  }
}
export function fix_line_numbers(root, doc) {
  const result = [],
    replacements = new Map();
  for (const [locator, where] of _locators(doc)) {
    if (locator.line == null) continue;
    const source = resolve_path(root, locator.path);
    if (!is_file(source)) continue;
    const token = first_locatable(locator);
    if (!token) continue;
    let lines = split_lines(fs.readFileSync(source, "utf8"));
    if (token.kind === "符号") lines = _code_lines(lines);
    if (
      locator.line >= 1 &&
      locator.line <= lines.length &&
      token_line_matches(lines[locator.line - 1], token)
    )
      continue;
    let matches =
      token.kind === "符号"
        ? _definition_lines(lines, last_symbol(token.value))
        : [];
    if (matches.length !== 1)
      matches = lines.flatMap((line, i) =>
        token_line_matches(line, token) ? [i + 1] : [],
      );
    if (matches.length !== 1) {
      result.push(
        new Issue(
          doc.path,
          locator.doc_line,
          where,
          "错误",
          `无法唯一定位：${token.kind === "符号" ? last_symbol(token.value) : token.value}（${locator.path}）`,
        ),
      );
      continue;
    }
    const new_line = matches[0];
    replacements.set(locator.doc_line, [locator.path, locator.line, new_line]);
    result.push(
      new Issue(
        doc.path,
        locator.doc_line,
        where,
        "提示",
        `已修正行号：${locator.path} ${locator.line} -> ${new_line}`,
      ),
    );
  }
  if (replacements.size) {
    const file = resolve_path(root, doc.path),
      text = strict_text(file);
    const lines =
      text.match(
        /[^\n\r\v\f\x1c-\x1e\x85\u2028\u2029]*(?:\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]|$)/g,
      ) || [];
    if (lines.at(-1) === "") lines.pop();
    for (const [doc_line, [p, old, new_line]] of replacements) {
      const exp = new RegExp(escape_regex(p) + ":" + old + "(?!\\d)");
      lines[doc_line - 1] = lines[doc_line - 1].replace(
        exp,
        (m) => m.slice(0, m.lastIndexOf(":")) + ":" + new_line,
      );
    }
    const rewritten = lines.join("");
    if (rewritten !== text) fs.writeFileSync(file, rewritten, "utf8");
  }
  return result;
}
