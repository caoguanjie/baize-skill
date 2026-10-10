/** 读取 Skill 目录内的项目设置，保留原版的三个机器字段。 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { split_table_row } from "./chain_doc.mjs";
import { strip, lstrip } from "./chain_layout.mjs";
import {
  is_file,
  read_text,
  split_lines,
  resolve_path,
} from "./chain_utils.mjs";

export const DEFAULT_PATH = path.join(
  path.dirname(resolve_path(process.cwd(), fileURLToPath(import.meta.url))),
  "..",
  "references",
  "项目设置.md",
);
export const MISSING = "缺少项目设置，先完成首次使用";
export class SettingsError extends Error {}
export class Settings {
  constructor(contract, layers, extra_fields) {
    Object.assign(this, { contract, layers, extra_fields });
  }
}
export function _is_none(value) {
  return !value || value === "无" || /^无[；，;,]/u.test(value);
}
export function _names(value) {
  return _is_none(value)
    ? []
    : value
        .split("、")
        .map((x) => strip(strip(x).replace(/^`+|`+$/g, "")))
        .filter(Boolean);
}
export function _path(value) {
  if (_is_none(value)) return null;
  const text = strip(strip(value).replace(/^`+|`+$/g, ""));
  if (
    !text ||
    path.posix.isAbsolute(text) ||
    text.split("/").includes("..") ||
    /[:\\]/u.test(text)
  ) {
    throw new SettingsError(
      "接口契约必须为当前目录内的相对路径（使用 /），或写无",
    );
  }
  return text;
}
export function load_settings(file = DEFAULT_PATH) {
  if (!is_file(file)) throw new SettingsError(`${MISSING}（未找到 ${file}）`);
  const rows = {};
  for (const line of split_lines(read_text(file))) {
    if (lstrip(line).startsWith("|")) {
      const cells = split_table_row(line);
      if (
        cells.length >= 2 &&
        ["接口契约", "右栏层名", "卡片扩展字段"].includes(cells[0])
      )
        rows[cells[0]] = strip(cells[1]);
    }
  }
  const layers = _names(rows["右栏层名"] ?? "");
  if (!layers.length)
    throw new SettingsError(`${MISSING}（项目设置缺少：右栏层名）`);
  return new Settings(
    _path(rows["接口契约"] ?? ""),
    layers,
    _names(rows["卡片扩展字段"] ?? ""),
  );
}
