/** 与 Python 原版一致的 UTF-8、换行及路径语义。 */
import fs from "node:fs";
import path from "node:path";

export function read_text(file) {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
    .decode(fs.readFileSync(file))
    .replace(/\r\n?/g, "\n");
}
export function split_lines(text) {
  if (!text) return [];
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
  if (/[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]$/u.test(text)) lines.pop();
  return lines;
}
export function is_file(file) {
  try {
    return fs.statSync(file).isFile();
  } catch (e) {
    if (["ENOENT", "ENOTDIR"].includes(e.code)) return false;
    throw e;
  }
}
export function is_dir(file) {
  try {
    return fs.statSync(file).isDirectory();
  } catch (e) {
    if (["ENOENT", "ENOTDIR"].includes(e.code)) return false;
    throw e;
  }
}
export function resolve_path(root, relative = "") {
  // 按组件解析，避免 alias/.. 在跟随软链之前被 path.resolve 折叠。
  let raw = path.isAbsolute(relative)
    ? relative
    : `${path.resolve(root)}${path.sep}${relative}`;
  let current = path.parse(raw).root;
  const components = (value) => value.split(path.sep === "\\" ? /[\\/]/u : "/");
  let parts = components(raw.slice(current.length));
  let links = 0;
  while (parts.length) {
    const part = parts.shift();
    if (!part || part === ".") continue;
    if (part === "..") {
      current = path.dirname(current);
      continue;
    }
    const next = path.join(current, part);
    let link = false;
    try {
      link = fs.lstatSync(next).isSymbolicLink();
    } catch (e) {
      if (!["ENOENT", "ENOTDIR"].includes(e.code)) throw e;
    }
    if (link) {
      if (++links > 40) throw new Error(`软链循环或层级过深：${next}`);
      const target = fs.readlinkSync(next);
      if (path.isAbsolute(target)) {
        current = path.parse(target).root;
        parts = components(target.slice(current.length)).concat(parts);
      } else parts = components(target).concat(parts);
    } else current = next;
  }
  return current;
}
export function within(root, target) {
  const rel = path.relative(root, target);
  return (
    !path.isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${path.sep}`)
  );
}
export function posix_path(value) {
  return value.split(path.sep).join("/");
}
// Python 默认排序比较 Unicode 码点，避免平台 locale 或 UTF-16 顺序改变输出。
export function compare_text(first, second) {
  const a = [...first],
    b = [...second];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const delta = a[i].codePointAt(0) - b[i].codePointAt(0);
    if (delta) return delta;
  }
  return a.length - b.length;
}
