/** 检查链路文档中的链接和源码锚点。 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  CHAIN_DIR,
  Issue,
  discover_docs,
  parse_doc,
  parse_jumps,
  same_display_column,
  split_at_column,
  split_table_row,
  BUILTIN_LAYERS,
  CARD_FIELDS,
  MAX_WIDTH,
  display_width,
} from "./chain_doc.mjs";
import {
  width_units,
  WIDTH_TOLERANCE,
  WORD_CHARS,
  SPACE,
  WHITE_CHARS,
  DIGIT,
  decimal_int,
  strip,
} from "./chain_layout.mjs";
import { casefold } from "./unicode_east_asian_width.mjs";
import { read_text, split_lines, resolve_path } from "./chain_utils.mjs";
import {
  fix_line_numbers,
  write_cross_table,
  build_cross_table,
  CROSS_START,
  CROSS_END,
} from "./chain_fix.mjs";
const exists = (file) => {
  try {
    fs.statSync(file);
    return true;
  } catch (e) {
    if (["ENOENT", "ENOTDIR"].includes(e.code)) return false;
    throw e;
  }
};
const is_file = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    if (["ENOENT", "ENOTDIR"].includes(e.code)) return false;
    throw e;
  }
};
const escape_regex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const _last_symbol = (value) =>
  value.replace(/\(\)$/, "").split(".").at(-1);
const compare = (a, b) => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const d = compare(a[i], b[i]);
      if (d) return d;
    }
    return a.length - b.length;
  }
  const x = Array.from(String(a)),
    y = Array.from(String(b));
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
};
const py_string = (s) => {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  return (
    q +
    s
      .replaceAll("\\", "\\\\")
      .replaceAll(q, "\\" + q)
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r")
      .replaceAll("\t", "\\t") +
    q
  );
};
const py_repr = (v) =>
  v === null || v === undefined
    ? "None"
    : typeof v === "string"
      ? py_string(v)
      : Array.isArray(v)
        ? "[" + v.map(py_repr).join(", ") + "]"
        : String(v);
const tuple_repr = (v) =>
  "(" +
  v.map((x) => (Array.isArray(x) ? py_repr(x) : py_repr(x))).join(", ") +
  (v.length === 1 ? "," : "") +
  ")";
const list_tuples = (rows) => "[" + rows.map(tuple_repr).join(", ") + "]";
const keys = (rows) => new Map(rows.map((row) => [JSON.stringify(row), row]));
const ordered = (map) => [...map.values()].sort(compare);
const equal_sets = (a, b) =>
  a.size === b.size && [...a.keys()].every((k) => b.has(k));
const difference = (a, b) =>
  ordered(new Map([...a].filter(([k]) => !b.has(k))));
const fmt = (value) => String(value);

export function load_openapi(root, contract) {
  if (contract == null || !is_file(resolve_path(root, contract))) return null;
  try {
    const data = JSON.parse(read_text(resolve_path(root, contract)));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    const paths = Object.hasOwn(data, "paths") ? data.paths : {};
    if (!paths || typeof paths !== "object" || Array.isArray(paths))
      throw new Error();
    return Object.fromEntries(
      Object.entries(paths).map(([route, methods]) => {
        if (
          methods == null ||
          (typeof methods !== "object" && typeof methods !== "string") ||
          (Array.isArray(methods) &&
            methods.some((m) => m !== null && typeof m === "object"))
        )
          throw new Error();
        return [
          route,
          new Set(
            typeof methods === "string"
              ? Array.from(methods)
              : Array.isArray(methods)
                ? methods
                : Object.keys(methods),
          ),
        ];
      }),
    );
  } catch {
    throw new Error(`OpenAPI 解析失败：${contract}`);
  }
}
export function first_locatable(loc) {
  return (
    loc.tokens.find(
      (t) =>
        ["符号", "选择器"].includes(t.kind) ||
        (t.kind === "类型" && ["表", "事件"].includes(t.type_word)),
    ) ?? null
  );
}
export function token_line_matches(text_line, token) {
  if (token.kind === "符号") {
    const value = _last_symbol(token.value);
    return new RegExp(
      "(?<![A-Za-z0-9_$])" + escape_regex(value) + "(?![A-Za-z0-9_$])",
      "u",
    ).test(text_line);
  }
  if (token.kind === "选择器") {
    const value = token.value.startsWith("data-testid=")
      ? token.value.slice(token.value.indexOf("=") + 1)
      : token.value.replace(/^[.#]+/, "");
    return text_line.includes(value);
  }
  return (
    token.kind === "类型" &&
    ["表", "事件"].includes(token.type_word) &&
    text_line.includes(token.value)
  );
}
export function _heading_slug(heading) {
  const title = casefold(
    strip(heading.replace(new RegExp("^#{1,6}" + SPACE + "+", "u"), "")),
  ).replace(
    new RegExp("[^" + WORD_CHARS + "\\-" + WHITE_CHARS + "]", "gu"),
    "",
  );
  return title.replace(new RegExp(SPACE + "+", "gu"), "-");
}
export function check_links(root, doc) {
  const result = [];
  for (const [target, line] of doc.links) {
    if (
      !exists(
        resolve_path(
          root,
          path.isAbsolute(target)
            ? target
            : path.posix.dirname(doc.path) + "/" + target,
        ),
      )
    )
      result.push(
        new Issue(doc.path, line, "链接", "错误", `链接目标不存在：${target}`),
      );
  }
  let fenced = false;
  for (const [i, line] of doc.lines.entries()) {
    if (strip(line).startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const clean = line.replace(/`[^`]*`/g, "");
    for (const match of clean.matchAll(/\[[^\]]*\]\((<[^>]+>|[^)\s]+)\)/g)) {
      let href;
      try {
        href = decodeURIComponent(match[1].replace(/^[<>]+|[<>]+$/g, ""));
      } catch {
        href = match[1].replace(/^[<>]+|[<>]+$/g, "");
      }
      if (
        !href.includes("#") ||
        href.startsWith("http:") ||
        href.startsWith("https:")
      )
        continue;
      const at = href.indexOf("#"),
        target = href.slice(0, at),
        fragment = href.slice(at + 1);
      if (!fragment) continue;
      const file = target
        ? resolve_path(
            root,
            path.isAbsolute(target)
              ? target
              : path.posix.dirname(doc.path) + "/" + target,
          )
        : resolve_path(root, doc.path);
      if (!is_file(file)) continue;
      const slugs = split_lines(read_text(file))
        .filter((h) => /^#{1,6} /.test(h))
        .map(_heading_slug);
      if (!slugs.includes(casefold(fragment)))
        result.push(
          new Issue(doc.path, i + 1, "链接", "错误", `标题锚点不存在：${href}`),
        );
    }
  }
  return result;
}
export function check_connectors(doc, where, start_line, lines) {
  const issues = [];
  function markers(line, allowed) {
    const chars = Array.from(line),
      found = [];
    for (let pos = 0; pos < chars.length; pos++) {
      const char = chars[pos];
      if (
        allowed.includes(char) &&
        (char !== "v" ||
          ((pos === 0 ||
            new RegExp("^" + SPACE + "$", "u").test(chars[pos - 1])) &&
            (pos + 1 === chars.length ||
              new RegExp("^" + SPACE + "$", "u").test(chars[pos + 1]))))
      )
        found.push([width_units(chars.slice(0, pos).join("")), char]);
    }
    return found;
  }
  for (let index = 1; index < lines.length; index++) {
    const previous = lines[index - 1],
      current = lines[index],
      trimmed = strip(previous),
      connector_only =
        !!trimmed && Array.from(trimmed).every((c) => "+-|v ".includes(c)),
      origins = markers(previous, "+|v").map(([col]) => col);
    if (!previous.includes("+-") && !connector_only) {
      const pipes = markers(previous, "|").map(([c]) => c);
      for (const [column] of markers(current, "v")) {
        const nearby = pipes.filter(
          (origin) => Math.abs(column - origin) <= 500,
        );
        if (
          nearby.length &&
          !nearby.some((origin) => same_display_column(column, origin))
        )
          issues.push(
            new Issue(
              doc,
              start_line + index,
              where,
              "错误",
              `连接线错位：第 ${index + 1} 行 ${fmt(column / 100)} 列没有上方接点`,
            ),
          );
      }
      continue;
    }
    for (const [column] of markers(current, "|v")) {
      if (
        origins.length &&
        !origins.some((origin) => same_display_column(column, origin))
      )
        issues.push(
          new Issue(
            doc,
            start_line + index,
            where,
            "错误",
            `连接线错位：第 ${index + 1} 行 ${fmt(column / 100)} 列没有上方接点`,
          ),
        );
    }
  }
  return issues;
}
export function check_branch_layout(doc, where, start_line, lines) {
  const hanging = lines.flatMap((line, index) =>
    /^\s*\+--(?:>|[^+]*(?:-->|=>|→))/.test(line) ? [start_line + index] : [],
  );
  return hanging.length < 2
    ? []
    : [
        new Issue(
          doc,
          hanging[1],
          where,
          "错误",
          "分支版式错误：多条条件挂在竖干上；请从共享判断横向分叉并分别向下",
        ),
      ];
}
export function check_submodule_index(doc, docs) {
  if (doc.kind !== "业务全景" || !doc.path.endsWith("/总览.md")) return [];
  const start = doc.lines.indexOf("## 子模块索引");
  if (start < 0)
    return [
      new Issue(
        doc.path,
        doc.h1_line,
        "子模块索引",
        "错误",
        "缺少：子模块索引",
      ),
    ];
  let end = doc.lines.findIndex(
    (line, i) => i > start && line.startsWith("## "),
  );
  if (end < 0) end = doc.lines.length;
  const table = doc.lines
    .slice(start + 1, end)
    .flatMap((line, i) =>
      line.startsWith("|") ? [[start + i + 2, line]] : [],
    );
  if (
    table.length < 3 ||
    JSON.stringify(split_table_row(table[0][1]).slice(0, 2)) !==
      JSON.stringify(["模块", "子模块"])
  )
    return [
      new Issue(
        doc.path,
        start + 1,
        "子模块索引",
        "错误",
        "子模块索引表头不符合约定",
      ),
    ];
  const actual = new Map(),
    issues = [],
    parent = path.posix.dirname(doc.path);
  for (const [line_number, row] of table.slice(2)) {
    const cells = split_table_row(row),
      module =
        cells.length > 1
          ? cells[0].match(new RegExp("^(" + DIGIT + "{2}) (.+)$", "u"))
          : null,
      sub =
        cells.length > 1
          ? cells[1].match(
              new RegExp("^\\[(" + DIGIT + "+) (.+)\\]\\(([^)]+)\\)$", "u"),
            )
          : null;
    if (!module || !sub) {
      issues.push(
        new Issue(
          doc.path,
          line_number,
          "子模块索引",
          "错误",
          "索引行格式不符合约定",
        ),
      );
      continue;
    }
    const module_number = decimal_int(module[1]),
      module_name = module[2],
      sub_number = decimal_int(sub[1]),
      sub_name = sub[2];
    let href;
    try {
      href = decodeURIComponent(sub[3]);
    } catch {
      href = sub[3];
    }
    const at = href.indexOf("#"),
      target = at < 0 ? href : href.slice(0, at),
      fragment = at < 0 ? "" : href.slice(at + 1),
      module_doc = Object.values(docs).find(
        (d) =>
          d.kind === "模块" &&
          compare(d.module, [module_number, module_name]) === 0 &&
          path.posix.dirname(d.path) === parent,
      ),
      expected = `${String(module_number).padStart(2, "0")}-${module_name}.md`,
      wanted = _heading_slug(`## 子模块 ${sub_number}：${sub_name}`);
    if (
      !module_doc ||
      target !== expected ||
      casefold(fragment) !== wanted ||
      !module_doc.submodules.some(
        (s) => s.number === sub_number && s.name === sub_name,
      )
    )
      issues.push(
        new Issue(
          doc.path,
          line_number,
          "子模块索引",
          "错误",
          `子模块索引目标不一致：${cells[0]} / ${cells[1]}`,
        ),
      );
    const row_key = [expected, sub_number, sub_name],
      key = JSON.stringify(row_key);
    if (actual.has(key))
      issues.push(
        new Issue(
          doc.path,
          line_number,
          "子模块索引",
          "错误",
          `重复子模块：${tuple_repr(row_key)}`,
        ),
      );
    actual.set(key, row_key);
  }
  const expected_rows = keys(
    Object.values(docs)
      .filter((d) => d.kind === "模块" && path.posix.dirname(d.path) === parent)
      .flatMap((d) =>
        d.submodules.map((sub) => [
          path.posix.basename(d.path),
          sub.number,
          sub.name,
        ]),
      ),
  );
  if (!equal_sets(actual, expected_rows))
    issues.push(
      new Issue(
        doc.path,
        start + 1,
        "子模块索引",
        "错误",
        `索引与子模块不一致：缺少 ${list_tuples(difference(expected_rows, actual))}，多出 ${list_tuples(difference(actual, expected_rows))}`,
      ),
    );
  return issues;
}
export function* _locators(doc) {
  for (const sub of doc.submodules)
    for (const anchor of sub.anchors) yield [anchor, anchor.node];
  if (doc.overview) {
    const label = doc.overview.list_kind || "子模块";
    for (const row of doc.overview.rows)
      if (row.entry) yield [row.entry, `${label} ${row.number}`];
  }
}
export function check_anchors(root, doc, openapi, contract = null) {
  const result = [];
  let skipped = false;
  for (const [loc, where] of _locators(doc)) {
    const file = resolve_path(root, loc.path);
    if (!is_file(file)) {
      for (const token of loc.tokens)
        if (token.kind === "类型" && token.type_word === "能力")
          result.push(
            new Issue(
              doc.path,
              loc.doc_line,
              where,
              "错误",
              `能力文档不存在：${CHAIN_DIR}/能力/${token.value}.md`,
            ),
          );
      result.push(
        new Issue(
          doc.path,
          loc.doc_line,
          where,
          "错误",
          `文件不存在：${loc.path}`,
        ),
      );
      continue;
    }
    const content = fs.readFileSync(file, "utf8").replace(/\r\n?|\n/g, "\n"),
      lines = split_lines(content);
    for (const token of loc.tokens) {
      let message = null;
      if (
        token.kind === "符号" &&
        !lines.some((line) => token_line_matches(line, token))
      )
        message = `符号不存在：${_last_symbol(token.value)}（${loc.path}）`;
      else if (
        token.kind === "选择器" &&
        !lines.some((line) => token_line_matches(line, token))
      ) {
        const value = token.value.startsWith("data-testid=")
          ? token.value.slice(token.value.indexOf("=") + 1)
          : token.value.replace(/^[.#]+/, "");
        message = `选择器不存在：${value}（${loc.path}）`;
      } else if (token.kind === "类型") {
        if (
          ["表", "事件"].includes(token.type_word) &&
          !content.includes(token.value)
        )
          message = `${token.type_word}不存在：${token.value}（${loc.path}）`;
        else if (token.type_word === "接口" && openapi === null) {
          if (!skipped) {
            skipped = true;
            result.push(
              new Issue(
                doc.path,
                loc.doc_line,
                where,
                "提示",
                `${contract ? `接口契约不存在：${contract}` : "项目设置未提供接口契约"}，跳过接口核对`,
              ),
            );
          }
        } else if (token.type_word === "接口") {
          const at = token.value.indexOf(" "),
            method = token.value.slice(0, at),
            route = token.value.slice(at + 1);
          if (
            at < 0 ||
            !(Object.hasOwn(openapi, route) ? openapi[route] : new Set()).has(
              method.toLowerCase(),
            )
          )
            message = `接口不存在：${token.value}（${contract}）`;
        } else if (
          token.type_word === "能力" &&
          !is_file(
            resolve_path(root, CHAIN_DIR + "/能力/" + token.value + ".md"),
          )
        )
          message = `能力文档不存在：${CHAIN_DIR}/能力/${token.value}.md`;
      }
      if (message)
        result.push(new Issue(doc.path, loc.doc_line, where, "错误", message));
    }
    const first = first_locatable(loc);
    if (
      loc.line != null &&
      first &&
      (loc.line < 1 ||
        loc.line > lines.length ||
        !token_line_matches(lines[loc.line - 1], first))
    )
      result.push(
        new Issue(
          doc.path,
          loc.doc_line,
          where,
          "提示",
          `行号漂移：${loc.path} 第 ${loc.line} 行不含 ${first.kind === "符号" ? _last_symbol(first.value) : first.value}`,
        ),
      );
  }
  return result;
}
export function run_check(root, targets = [], fix = false, settings = null) {
  settings ??= { contract: null, layers: null, extra_fields: [] };
  // 仅本次检查共享完全相同的只读 Git 查询；下一次运行重新读取仓库状态。
  const git_reads = new Map();
  const read_git = (git_root, ...args) => {
    const key = JSON.stringify([git_root, args]);
    if (!git_reads.has(key)) git_reads.set(key, _git(git_root, ...args));
    return git_reads.get(key);
  };
  let docs = Object.fromEntries(
      discover_docs(root).map((name) => [name, parse_doc(root, name)]),
    ),
    selected = targets.length ? targets : Object.keys(docs),
    fix_issues = [];
  if (fix) {
    for (const name of selected)
      fix_issues.push(...fix_line_numbers(root, docs[name]));
    if (selected.includes(`${CHAIN_DIR}/README.md`))
      write_cross_table(root, Object.values(docs));
    docs = Object.fromEntries(
      discover_docs(root).map((name) => [name, parse_doc(root, name)]),
    );
  }
  let openapi;
  try {
    openapi = load_openapi(root, settings.contract);
  } catch (exc) {
    return [
      new Issue(
        selected[0] || `${CHAIN_DIR}/README.md`,
        1,
        "文档",
        "错误",
        exc.message,
      ),
    ];
  }
  const issues = [...fix_issues],
    description_issues = check_table_descriptions(docs);
  for (const name of selected) {
    const doc = docs[name];
    issues.push(
      ...(description_issues[name] || []),
      ...doc.issues,
      ...check_links(root, doc),
      ...check_anchors(root, doc, openapi, settings.contract),
      ...check_structure(doc, docs, settings.layers, settings.extra_fields),
      ...check_submodule_index(doc, docs),
      ...check_freshness(root, doc, read_git),
    );
    if (doc.kind === "顶层")
      issues.push(...check_cross_table(root, Object.values(docs)));
  }
  return issues.sort((a, b) =>
    compare(
      [a.doc, a.line, a.where, a.message],
      [b.doc, b.line, b.where, b.message],
    ),
  );
}
export function check_structure(doc, docs, layers = null, extra_fields = []) {
  const result = [],
    values = Object.values(docs),
    add = (line, where, message, level = "错误") =>
      result.push(new Issue(doc.path, line, where, level, message));
  if (doc.kind === "顶层" || !doc.overview) return result;
  const overview = doc.overview,
    expected_kind = doc.kind === "业务全景" ? "模块" : "子模块";
  if (overview.list_kind != null && overview.list_kind !== expected_kind)
    add(overview.line, "总览", `清单表头不符合约定：应为 ${expected_kind}`);
  if (!overview.diagram) add(overview.line, "总览", "缺少：总览图");
  if (overview.list_kind == null) add(overview.line, "总览", "缺少：清单");
  if (overview.diagram) {
    for (const [offset, line] of overview.diagram.lines.entries()) {
      const width = display_width(line);
      if (width > MAX_WIDTH + WIDTH_TOLERANCE)
        add(
          overview.diagram.start_line + offset,
          "总览",
          `图宽超限：${fmt(width)} 列，上限 ${MAX_WIDTH}`,
        );
    }
    result.push(
      ...check_connectors(
        doc.path,
        "总览",
        overview.diagram.start_line,
        overview.diagram.lines,
      ),
      ...check_branch_layout(
        doc.path,
        "总览",
        overview.diagram.start_line,
        overview.diagram.lines,
      ),
    );
  }
  if (overview.diagram && overview.list_kind) {
    const graph = keys(overview.nodes.map(([n, name]) => [n, name])),
      listed = keys(overview.rows.map((r) => [r.number, r.name]));
    if (!equal_sets(graph, listed))
      add(
        overview.line,
        "总览",
        `总览图与清单不一致：图 ${list_tuples(ordered(graph))}，清单 ${list_tuples(ordered(listed))}`,
      );
    const by_number = new Map();
    for (const [number, name] of overview.nodes) {
      if (!by_number.has(number)) by_number.set(number, new Set());
      by_number.get(number).add(name);
    }
    for (const [number, names] of by_number)
      if (names.size > 1)
        add(
          overview.line,
          "总览",
          `总览图与清单不一致：[${number}] 有多个名称`,
        );
  }
  if (expected_kind === "子模块") {
    const listed = keys(overview.rows.map((r) => [r.number, r.name])),
      actual = keys(doc.submodules.map((s) => [s.number, s.name]));
    if (!equal_sets(listed, actual))
      add(
        overview.line,
        "总览",
        `清单与子模块标题不一致：清单 ${list_tuples(ordered(listed))}，标题 ${list_tuples(ordered(actual))}`,
      );
    for (const row of overview.rows) {
      const sub = doc.submodules.find((s) => s.number === row.number);
      if (!row.entry)
        add(row.doc_line, `子模块 ${row.number}`, "缺少：清单入口");
      else if (sub) {
        const wanted = keys(
            row.entry.tokens
              .filter((t) => t.kind === "符号")
              .map((t) => [row.entry.path, t.value.replace(/\(\)$/, "")]),
          ),
          actual_entries = keys(
            sub.anchors.flatMap((a) =>
              a.tokens
                .filter((t) => t.kind === "符号")
                .map((t) => [a.path, t.value.replace(/\(\)$/, "")]),
            ),
          );
        const matched = wanted.size
          ? [...wanted.keys()].every((k) => actual_entries.has(k))
          : sub.anchors.some((a) => a.path === row.entry.path);
        if (!matched)
          add(
            row.doc_line,
            `子模块 ${row.number}`,
            `清单入口不在锚点表：${row.entry.path} ${wanted.size ? [...wanted.values()][0][1] : ""}`,
          );
      }
    }
  } else {
    const parent = path.posix.dirname(doc.path),
      children = keys(
        values
          .filter(
            (d) =>
              d.kind === "模块" &&
              d.module &&
              path.posix.dirname(d.path) === parent,
          )
          .map((d) => d.module),
      ),
      listed = keys(overview.rows.map((r) => [r.number, r.name]));
    if (!equal_sets(listed, children))
      add(
        overview.line,
        "总览",
        `清单与模块文件不一致：清单 ${list_tuples(ordered(listed))}，文件 ${list_tuples(ordered(children))}`,
      );
    const numbers = ordered(children)
      .map(([n]) => n)
      .sort((a, b) => a - b);
    if (numbers.some((n, i) => n !== i + 1))
      add(overview.line, "总览", `编号不连续：模块 ${py_repr(numbers)}`);
    if (children.size > 10)
      add(
        overview.line,
        "总览",
        `规模超限：业务有 ${children.size} 个模块，上限 10`,
        "提示",
      );
    for (const row of overview.rows) {
      const module = values.find(
        (d) =>
          d.kind === "模块" &&
          d.module &&
          compare(d.module, [row.number, row.name]) === 0 &&
          path.posix.dirname(d.path) === parent,
      );
      if (doc.path.endsWith("/总览.md")) {
        const expected_link = `${String(row.number).padStart(2, "0")}-${row.name}.md`;
        if (!row.detail || !row.detail.includes(`](${expected_link})`))
          add(
            row.doc_line,
            `模块 ${row.number}`,
            `详情链接不匹配：${expected_link}`,
          );
      } else if (!row.entry)
        add(row.doc_line, `模块 ${row.number}`, "缺少：清单入口");
      else if (module?.overview?.rows.length) {
        const first = module.overview.rows[0].entry,
          wanted = [
            row.entry.path,
            row.entry.tokens
              .filter((t) => t.kind === "符号")
              .map((t) => t.value.replace(/\(\)$/, "")),
          ],
          actual = first
            ? [
                first.path,
                first.tokens
                  .filter((t) => t.kind === "符号")
                  .map((t) => t.value.replace(/\(\)$/, "")),
              ]
            : null;
        if (JSON.stringify(wanted) !== JSON.stringify(actual))
          add(
            row.doc_line,
            `模块 ${row.number}`,
            `模块入口与首个子模块入口不同：${tuple_repr(wanted)} != ${actual === null ? "None" : tuple_repr(actual)}`,
          );
      }
    }
  }
  if (doc.kind === "模块" && doc.module) {
    const wanted = `模块 ${doc.module[0]}：${doc.module[1]}`;
    if (doc.h1 !== wanted)
      add(
        doc.h1_line,
        `模块 ${doc.module[0]}`,
        `模块标题与文件名不一致：${doc.h1} != ${wanted}`,
      );
  }
  const sub_numbers = doc.submodules.map((s) => s.number).sort((a, b) => a - b);
  if (sub_numbers.some((n, i) => n !== i + 1))
    add(overview.line, "总览", `编号不连续：子模块 ${py_repr(sub_numbers)}`);
  if (doc.submodules.length > 6)
    add(
      overview.line,
      "总览",
      `规模超限：文件有 ${doc.submodules.length} 个子模块，上限 6`,
      "提示",
    );
  for (const sub of doc.submodules) {
    const where = `子模块 ${sub.number}`;
    if (!sub.diagram) {
      add(sub.line, where, "缺少：详图");
      continue;
    }
    const diagram = sub.diagram,
      left_lines = diagram.split_col
        ? diagram.lines
            .slice(5, -1)
            .map((l) =>
              Array.from(split_at_column(l, diagram.split_col)[0])
                .slice(2)
                .join(""),
            )
        : [];
    result.push(
      ...check_connectors(doc.path, where, diagram.start_line + 5, left_lines),
      ...check_branch_layout(
        doc.path,
        where,
        diagram.start_line + 5,
        left_lines,
      ),
    );
    if (diagram.lines.length) {
      const expected = display_width(diagram.lines[0]);
      if (expected > MAX_WIDTH + WIDTH_TOLERANCE)
        add(
          diagram.start_line,
          where,
          `图宽超限：${fmt(expected)} 列，上限 ${MAX_WIDTH}`,
        );
      const tolerance_units = Math.round(WIDTH_TOLERANCE * 100),
        at_column = (value, marker, column) =>
          Array.from(value).some(
            (char, offset) =>
              char === marker &&
              Math.abs(
                width_units(Array.from(value).slice(0, offset).join("")) -
                  column * 100,
              ) <= tolerance_units,
          );
      for (const [offset, line] of diagram.lines.entries()) {
        const index = offset + 1,
          current = display_width(line);
        if (
          Math.abs(width_units(line) - width_units(diagram.lines[0])) >
          tolerance_units
        )
          add(
            diagram.start_line + offset,
            where,
            `详图对齐：第 ${index} 行宽 ${fmt(current)}，首行宽 ${fmt(expected)}`,
          );
        if (line && (!"|+".includes(line[0]) || line.at(-1) !== line[0]))
          add(
            diagram.start_line + offset,
            where,
            `详图边框：第 ${index} 行首尾框线不一致`,
          );
        const title_row =
          index === 2 &&
          diagram.lines.length > 2 &&
          diagram.lines[0].startsWith("+") &&
          diagram.lines[2].startsWith("+");
        if (line.startsWith("|") && line.endsWith("|") && !title_row) {
          const center_col = diagram.split_col;
          if (center_col == null || !at_column(line, "|", center_col)) {
            add(
              diagram.start_line + offset,
              where,
              `详图中线偏移：第 ${index} 行应在 ${center_col ?? "None"} 列`,
            );
            continue;
          }
          const chars = Array.from(line),
            centers = chars.flatMap((char, i) =>
              char === "|" &&
              Math.abs(
                width_units(chars.slice(0, i).join("")) - center_col * 100,
              ) <= tolerance_units
                ? [i]
                : [],
            ),
            center = centers.reduce((a, b) =>
              Math.abs(
                width_units(chars.slice(0, a).join("")) - center_col * 100,
              ) <=
              Math.abs(
                width_units(chars.slice(0, b).join("")) - center_col * 100,
              )
                ? a
                : b,
            ),
            right_content = chars
              .slice(center + 1, -1)
              .join("")
              .trim();
          if (
            index > 5 &&
            right_content &&
            !(
              ["|", "+"].some((m) => at_column(line, m, center_col + 2)) &&
              ["|", "+"].some((m) =>
                at_column(line, m, Math.round(expected) - 3),
              )
            )
          )
            add(
              diagram.start_line + offset,
              where,
              `详图卡片边界：第 ${index} 行卡片边框错位`,
            );
        } else if (
          line.startsWith("+") &&
          Array.from(line).filter((c) => c === "+").length === 3 &&
          diagram.split_col != null &&
          !at_column(line, "+", diagram.split_col)
        )
          add(
            diagram.start_line + offset,
            where,
            `详图中线偏移：第 ${index} 行应在 ${diagram.split_col} 列`,
          );
      }
    }
    if (diagram.nodes.length > 12)
      add(
        sub.line,
        where,
        `规模超限：子模块 ${sub.number} 有 ${diagram.nodes.length} 个节点，上限 12`,
        "提示",
      );
    const graph_nodes = new Set(diagram.nodes.map(([n]) => n)),
      anchor_nodes = new Set(sub.anchors.map((a) => a.node)),
      card_nodes = new Map();
    for (const card of diagram.cards) {
      if (!card_nodes.has(card.node)) card_nodes.set(card.node, []);
      card_nodes.get(card.node).push(card.doc_line);
    }
    for (const [node, line] of diagram.nodes) {
      if (!anchor_nodes.has(node)) add(line, node, `节点缺少锚点：${node}`);
      if (!card_nodes.has(node)) add(line, node, `节点缺少卡片：${node}`);
    }
    for (const anchor of sub.anchors)
      if (!graph_nodes.has(anchor.node))
        add(anchor.doc_line, anchor.node, `锚点节点不在详图：${anchor.node}`);
    for (const [node, lines] of card_nodes) {
      if (!graph_nodes.has(node))
        add(lines[0], node, `卡片节点不在详图：${node}`);
      if (lines.length > 1) add(lines[1], node, `重复卡片：${node}`);
    }
    const numbers = diagram.nodes
      .map(([node]) => decimal_int(node.slice(1).split(".")[1]))
      .sort((a, b) => a - b);
    if (numbers.some((n, i) => n !== i + 1))
      add(sub.line, where, `节点编号不连续或重复：${py_repr(numbers)}`);
    for (const [node, line] of diagram.nodes) {
      const [prefix] = node.slice(1).split(".");
      if (decimal_int(prefix) !== sub.number)
        add(line, node, `节点编号错误：${node}，前缀应为 N${sub.number}`);
    }
    for (const card of diagram.cards) {
      if (
        layers !== null &&
        ![...layers, ...BUILTIN_LAYERS].includes(card.layer)
      )
        add(card.doc_line, card.node, `未知层名：${card.layer}`);
      for (const [field, line] of card.fields)
        if (
          layers !== null &&
          ![...CARD_FIELDS, ...extra_fields].includes(field)
        )
          add(line, card.node, `未知字段：${field}`);
      const actual_calls = new Set(
        sub.anchors
          .filter((a) => a.node === card.node)
          .flatMap((a) =>
            a.tokens
              .filter((t) => t.kind === "符号")
              .map((t) => _last_symbol(t.value)),
          ),
      );
      for (const call of card.calls)
        if (!actual_calls.has(_last_symbol(call)))
          add(card.doc_line, card.node, `卡片方法不在锚点表：${call}`);
    }
  }
  const diagrams = [
    ...(overview.diagram ? [overview.diagram] : []),
    ...doc.submodules.filter((s) => s.diagram).map((s) => s.diagram),
  ];
  for (const diagram of diagrams)
    for (let jump of diagram.jumps) {
      let wrapped_selected = false;
      if (jump.continuation) {
        const exact_submodule =
            jump.kind === "子模块" &&
            doc.submodules.some(
              (s) =>
                s.number === decimal_int(jump.target) &&
                (jump.sub == null || s.name === jump.sub),
            ),
          exact_module =
            jump.kind === "模块" &&
            values.some(
              (d) =>
                d.kind === "模块" &&
                d.business === doc.business &&
                d.module &&
                d.module[1] === jump.target &&
                (!jump.sub || d.submodules.some((s) => s.name === jump.sub)),
            );
        if (!exact_submodule && !exact_module) {
          jump = parse_jumps("==> " + jump.continuation, jump.doc_line)[0];
          wrapped_selected = true;
        }
      }
      const raw = "==> " + jump.raw;
      if (jump.kind == null) {
        add(
          jump.doc_line,
          diagram === overview.diagram ? "总览" : "文档",
          `无法识别的跳转：${raw}`,
        );
        continue;
      }
      if (jump.kind === "子模块") {
        const target = doc.submodules.find(
          (s) => s.number === decimal_int(jump.target),
        );
        if (!target) add(jump.doc_line, "文档", `跳转目标不存在：${raw}`);
        else if (
          jump.sub &&
          (wrapped_selected
            ? jump.sub !== target.name
            : !target.name.startsWith(jump.sub))
        )
          add(
            jump.doc_line,
            "文档",
            `跳转名称不一致：${raw}，实际是「${target.name}」`,
          );
      } else if (jump.kind === "模块") {
        const matches = values.filter(
            (d) =>
              d.kind === "模块" &&
              d.module &&
              (wrapped_selected
                ? d.module[1] === jump.target
                : d.module[1].startsWith(jump.target)) &&
              d.business === doc.business &&
              ["业务全景", "模块"].includes(doc.kind),
          ),
          target = matches.length === 1 ? matches[0] : null;
        if (
          !target ||
          (jump.sub &&
            !target.submodules.some((s) =>
              wrapped_selected
                ? s.name === jump.sub
                : s.name.startsWith(jump.sub),
            ))
        )
          add(jump.doc_line, "文档", `跳转目标不存在：${raw}`);
      } else if (jump.kind === "模块编号") {
        const matches = values.filter(
          (d) =>
            d.kind === "模块" &&
            d.module &&
            d.module[0] === decimal_int(jump.target) &&
            d.business === doc.business,
        );
        if (
          matches.length !== 1 ||
          (jump.sub && !matches[0].module[1].startsWith(jump.sub))
        )
          add(jump.doc_line, "文档", `跳转目标不存在：${raw}`);
      } else if (jump.kind === "业务") {
        if (
          ![
            `${CHAIN_DIR}/业务/${jump.target}.md`,
            `${CHAIN_DIR}/业务/${jump.target}/总览.md`,
            `${CHAIN_DIR}/业务/${jump.target}/README.md`,
          ].some((n) => Object.hasOwn(docs, n))
        )
          add(jump.doc_line, "文档", `跳转目标不存在：${raw}`);
      } else if (
        jump.kind === "能力" &&
        !Object.hasOwn(docs, `${CHAIN_DIR}/能力/${jump.target}.md`)
      )
        add(jump.doc_line, "文档", `跳转目标不存在：${raw}`);
    }
  return result;
}
export function _git(root, ...args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return {
    returncode: r.status ?? 127,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
    error: r.error,
  };
}
export function check_freshness(root, doc, read_git = _git) {
  if (read_git(root, "rev-parse", "--is-inside-work-tree").returncode)
    return [];
  if (
    read_git(root, "ls-files", "--error-unmatch", "--", doc.path).returncode ||
    read_git(root, "status", "--porcelain", "--", doc.path).stdout.trim()
  )
    return [];
  const commit = read_git(
    root,
    "log",
    "-1",
    "--format=%H",
    "--",
    doc.path,
  ).stdout.trim();
  if (!commit) return [];
  const seen = new Set(),
    result = [];
  for (const [loc, where] of _locators(doc)) {
    if (seen.has(loc.path)) continue;
    seen.add(loc.path);
    const later = read_git(
        root,
        "rev-list",
        "--count",
        `${commit}..HEAD`,
        "--",
        loc.path,
      ).stdout.trim(),
      dirty = read_git(
        root,
        "status",
        "--porcelain",
        "--",
        loc.path,
      ).stdout.trim();
    if ((later && Number(later) > 0) || dirty)
      result.push(
        new Issue(
          doc.path,
          loc.doc_line,
          where,
          "提示",
          `可能过期：${loc.path} 在文档提交后有改动`,
        ),
      );
  }
  return result;
}
export function check_cross_table(root, docs) {
  const readme = docs.find((d) => d.kind === "顶层");
  if (!readme) return [];
  const text = read_text(resolve_path(root, readme.path));
  if (!text.includes(CROSS_START) || !text.includes(CROSS_END))
    return [new Issue(readme.path, 1, "文档", "提示", "README 缺少交叉表标记")];
  const start = text.indexOf(CROSS_START) + CROSS_START.length,
    end = text.indexOf(CROSS_END, start);
  if (end < 0) throw new Error("substring not found");
  const trim = (s) => s.replace(/^\n+|\n+$/g, "");
  if (trim(text.slice(start, end)) !== trim(build_cross_table(docs)))
    return [
      new Issue(
        readme.path,
        text.slice(0, start).split("\n").length,
        "文档",
        "提示",
        "交叉表需要重新生成，运行 check --fix",
      ),
    ];
  return [];
}
export function check_table_descriptions(docs) {
  const descriptions = new Map(),
    locations = new Map(),
    result = {};
  for (const doc of Object.values(docs)) {
    if (doc.area !== "业务") continue;
    for (const sub of doc.submodules)
      for (const anchor of sub.anchors)
        for (const token of anchor.tokens) {
          if (
            token.kind === "类型" &&
            token.type_word === "表" &&
            token.description
          ) {
            if (!descriptions.has(token.value)) {
              descriptions.set(token.value, new Set());
              locations.set(token.value, []);
            }
            descriptions.get(token.value).add(token.description);
            locations
              .get(token.value)
              .push([doc.path, anchor.doc_line, anchor.node]);
          }
        }
  }
  for (const [name, variants] of descriptions) {
    if (variants.size < 2) continue;
    const message = `表中文说明冲突：${name}（${[...variants].sort(compare).join("、")}），请核对表注释`;
    for (const [doc, line, where] of locations.get(name)) {
      result[doc] ??= [];
      result[doc].push(new Issue(doc, line, where, "提示", message));
    }
  }
  return result;
}
