#!/usr/bin/env node
/** 白泽：从当前项目目录检查与反查 docs/链路全景/。 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { run_check } from "./chain_check.mjs";
import { CHAIN_DIR, discover_docs, parse_doc } from "./chain_doc.mjs";
import {
  GitUnavailable,
  find_refs,
  git_changed_paths,
  render_refs,
} from "./chain_refs.mjs";
import {
  DEFAULT_PATH,
  SettingsError,
  load_settings,
} from "./chain_settings.mjs";
import {
  is_file,
  is_dir,
  resolve_path,
  within,
  posix_path,
} from "./chain_utils.mjs";

const USAGE = "usage: chain.mjs [-h] {check,refs} ...";
function usage_error(message = "") {
  console.error(USAGE);
  if (message) console.error(`chain.mjs: error: ${message}`);
  return 2;
}
export function main(argv = process.argv.slice(2), settings_path = null) {
  const args = [...argv],
    command = args.shift();
  if (command === "--help" || command === "-h") {
    console.log(
      `${USAGE}\n\n白泽：检查与反查当前目录下 docs/链路全景/ 的链路文档\n\ncheck  检查文档结构、版式、源码锚点和新鲜度\nrefs   按文件、符号、表名、接口等反查链路`,
    );
    return 0;
  }
  if (!["check", "refs"].includes(command))
    return usage_error("需要 check 或 refs 子命令");
  const positional = [];
  let fix = false,
    git = false,
    literal = false;
  for (const arg of args) {
    if (!literal && arg === "--") {
      literal = true;
      continue;
    }
    if (!literal && ["-h", "--help"].includes(arg)) {
      console.log(
        command === "check"
          ? "usage: chain.mjs check [-h] [--fix] [documents ...]\n--fix  只修正漂移的行号并重建交叉表"
          : "usage: chain.mjs refs [-h] [--git] [keywords ...]\n--git  反查当前目录内未提交改动，需要 Git",
      );
      return 0;
    }
    if (!literal && arg === "--fix" && command === "check") {
      fix = true;
      continue;
    }
    if (!literal && arg === "--git" && command === "refs") {
      git = true;
      continue;
    }
    if (!literal && arg.startsWith("-"))
      return usage_error(`无法识别参数：${arg}`);
    positional.push(arg);
  }
  const root = resolve_path(process.cwd());
  if (command === "refs") {
    if (!git && !positional.length) return usage_error();
    const keywords = [...positional];
    if (git) {
      let changed;
      try {
        changed = git_changed_paths(root);
      } catch (e) {
        if (!(e instanceof GitUnavailable)) throw e;
        console.error(`refs --git 需要 Git：${e.message}`);
        return 2;
      }
      if (!changed.length && !keywords.length) {
        console.log("没有改动文件");
        return 0;
      }
      keywords.push(...changed.map((value) => "./" + value));
    }
    console.log(
      render_refs(
        find_refs(
          discover_docs(root).map((name) => parse_doc(root, name)),
          keywords,
        ),
      ).join("\n"),
    );
    return 0;
  }
  let settings;
  try {
    settings = load_settings(settings_path || DEFAULT_PATH);
  } catch (e) {
    if (!(e instanceof SettingsError)) throw e;
    console.error(e.message);
    return 2;
  }
  if (!is_dir(path.join(root, CHAIN_DIR))) {
    console.error(`当前目录下没有 ${CHAIN_DIR}/，请在项目目录运行：${root}`);
    return 2;
  }
  const targets = [];
  for (const argument of positional) {
    const candidate = resolve_path(root, argument);
    const relative = within(root, candidate)
      ? posix_path(path.relative(root, candidate))
      : "";
    if (
      !is_file(candidate) ||
      path.extname(candidate) !== ".md" ||
      !relative.startsWith(CHAIN_DIR + "/")
    ) {
      console.error(`文档不在 ${CHAIN_DIR}/ 下：${argument}`);
      return 2;
    }
    targets.push(relative);
  }
  const issues = run_check(root, targets, fix, settings);
  for (const issue of issues) console.log(issue.render());
  const errors = issues.filter((x) => x.level === "错误").length,
    hints = issues.filter((x) => x.level === "提示").length;
  console.log(`错误 ${errors} 条，提示 ${hints} 条`);
  return errors ? 1 : 0;
}
const is_main =
  import.meta.main ??
  (process.argv[1] &&
    !process.execArgv.some((arg) =>
      ["-e", "--eval", "-p", "--print"].includes(arg),
    ) &&
    pathToFileURL(resolve_path(process.cwd(), process.argv[1])).href ===
      import.meta.url);
if (is_main) process.exitCode = main();
