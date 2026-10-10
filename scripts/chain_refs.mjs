/** 按文件、符号和类型值反查文档；Git 路径以 NUL 分隔保留中文。 */
import { spawnSync } from "node:child_process";
import { compare_text } from "./chain_utils.mjs";
import { strip, rstrip, SPACE, DIGIT, decimal_int } from "./chain_layout.mjs";
export const EXTENSIONS = [
  ".py",
  ".ts",
  ".tsx",
  ".vue",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".kt",
  ".swift",
  ".java",
  ".cs",
  ".go",
  ".php",
  ".rb",
  ".rs",
  ".c",
  ".h",
  ".cpp",
  ".m",
  ".dart",
  ".scala",
  ".sh",
  ".sql",
  ".html",
  ".css",
  ".scss",
  ".xml",
  ".toml",
  ".yaml",
  ".yml",
  ".md",
  ".json",
];
export const METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];
export class RefHit {
  constructor(doc, section, node, locator) {
    Object.assign(this, { doc, section, node, locator });
  }
}
export function classify_keyword(keyword) {
  const value = strip(keyword);
  const method = new RegExp(
    `^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)${SPACE}+(.+)$`,
    "iu",
  ).exec(value);
  if (method) return ["接口", `${method[1].toUpperCase()} ${method[2]}`];
  if (value.includes("/") || EXTENSIONS.some((x) => value.endsWith(x)))
    return ["路径", value.replace(/^\.\//, "").replace(/\/+$/, "")];
  return ["名称", value.replace(/\(\)$/, "")];
}
export function _matches(locator, keyword) {
  const [kind, value] = keyword;
  if (kind === "路径")
    return locator.path === value || locator.path.startsWith(value + "/");
  for (const token of locator.tokens) {
    if (kind === "接口") {
      if (token.kind === "类型" && token.type_word === "接口") {
        const at = token.value.indexOf(" "),
          expected = value.indexOf(" ");
        if (
          at >= 0 &&
          token.value.slice(0, at).toUpperCase() === value.slice(0, expected) &&
          token.value.slice(at + 1) === value.slice(expected + 1)
        )
          return true;
      }
    } else if (token.kind === "符号") {
      const symbol = token.value.replace(/\(\)$/, "");
      if (symbol === value || symbol.split(".").at(-1) === value) return true;
    } else if (
      token.kind === "类型" &&
      ["表", "事件", "缓存", "外部", "能力"].includes(token.type_word) &&
      token.value === value
    )
      return true;
  }
  return false;
}
export function find_refs(docs, keywords) {
  const classified = keywords.map(classify_keyword),
    hits = [],
    seen = new Set();
  function add(doc, section, node, locator) {
    const key = JSON.stringify([
      doc.path,
      section,
      node,
      locator.doc_line,
      locator.path,
    ]);
    if (
      !seen.has(key) &&
      classified.some((keyword) => _matches(locator, keyword))
    ) {
      hits.push(new RefHit(doc.path, section, node, locator));
      seen.add(key);
    }
  }
  for (const doc of docs) {
    if (doc.overview) {
      const prefix = doc.overview.list_kind === "模块" ? "模块" : "子模块";
      for (const row of doc.overview.rows)
        if (row.entry)
          add(doc, `${prefix} ${row.number}：${row.name}`, null, row.entry);
    }
    for (const sub of doc.submodules)
      for (const anchor of sub.anchors)
        add(doc, `子模块 ${sub.number}：${sub.name}`, anchor.node, anchor);
  }
  return hits;
}
export class GitUnavailable extends Error {}
export function git_changed_paths(root) {
  const options = {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: Infinity,
  };
  const inside = spawnSync(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    options,
  );
  if (inside.error?.code === "ENOENT")
    throw new GitUnavailable("找不到 git 可执行文件");
  if (inside.status !== 0) throw new GitUnavailable("当前目录不在 Git 仓库内");
  function run(...args) {
    const result = spawnSync("git", args, options);
    if (result.error) throw new GitUnavailable(result.error.message);
    if (result.status !== 0) throw new GitUnavailable(strip(result.stderr));
    return result.stdout.split("\0");
  }
  // 禁止重命名折叠，旧锚点和新路径都需要被反查到。
  return [
    ...new Set([
      ...run("diff", "--name-only", "--no-renames", "--relative", "-z", "HEAD"),
      ...run("ls-files", "--others", "--exclude-standard", "-z"),
    ]),
  ]
    .filter(Boolean)
    .sort(compare_text);
}
export function render_refs(hits) {
  if (!hits.length)
    return ["未命中任何链路：可能是新代码还没进链路，或者链路本身有缺失"];
  const lines = [],
    by_doc = new Map();
  let count = 0;
  for (const hit of hits) {
    if (!by_doc.has(hit.doc)) by_doc.set(hit.doc, new Map());
    const sections = by_doc.get(hit.doc);
    if (!sections.has(hit.section)) sections.set(hit.section, []);
    sections.get(hit.section).push(hit);
  }
  for (const doc of [...by_doc.keys()].sort(compare_text)) {
    lines.push(doc);
    const sections = by_doc.get(doc);
    const section_number = (x) =>
      decimal_int(x.match(new RegExp(`${DIGIT}+`, "u"))?.[0] ?? "0");
    for (const section of [...sections.keys()].sort(
      (a, b) => section_number(a) - section_number(b) || compare_text(a, b),
    )) {
      const entries = [...sections.get(section)].sort(
        (a, b) =>
          a.locator.doc_line - b.locator.doc_line ||
          compare_text(a.node ?? "", b.node ?? ""),
      );
      const anchors = entries.filter((x) => x.node !== null);
      if (anchors.length) {
        lines.push("  " + section);
        for (const hit of anchors) {
          const loc = hit.locator,
            suffix = loc.line !== null ? ":" + loc.line : "";
          const tokens = loc.tokens
            .map((token) => "`" + token.value + "`")
            .join(" ");
          lines.push(
            rstrip(
              `    ${hit.node}  第 ${loc.doc_line} 行  ${loc.path}${suffix}  ${tokens}`,
            ),
          );
          count++;
        }
      } else {
        lines.push(
          `  ${section}（清单入口 第 ${entries[0].locator.doc_line} 行）`,
        );
        count++;
      }
    }
  }
  lines.push(`命中 ${count} 处`);
  return lines;
}
