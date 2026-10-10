import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { load_settings, SettingsError } from "../../scripts/chain_settings.mjs";
import {
  classify_keyword,
  find_refs,
  render_refs,
  git_changed_paths,
} from "../../scripts/chain_refs.mjs";
import {
  read_text,
  split_lines,
  resolve_path,
} from "../../scripts/chain_utils.mjs";

function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "baize settings 中文 "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function settings(
  root,
  contract = "`api/openapi.json`",
  layers = "路由层、 `服务层` 、数据层",
) {
  const file = path.join(root, "项目设置.md");
  fs.writeFileSync(
    file,
    `| 接口契约 | ${contract} |\r\n| 右栏层名 | ${layers} |\r\n| 卡片扩展字段 | 无 |\r\n`,
  );
  return file;
}
test("项目设置保留层名和中文路径，拒绝外部契约", (t) => {
  const root = temporary(t);
  const value = load_settings(settings(root));
  assert.deepEqual(
    { ...value },
    {
      contract: "api/openapi.json",
      layers: ["路由层", "服务层", "数据层"],
      extra_fields: [],
    },
  );
  assert.deepEqual(
    load_settings(settings(root, "无；纯前端", "无状态层")).layers,
    ["无状态层"],
  );
  for (const contract of [
    "../api.json",
    "/tmp/api.json",
    "C:\\api.json",
    "https://example.com/api.json",
  ]) {
    assert.throws(() => load_settings(settings(root, contract)), /接口契约/);
  }
  assert.throws(() => load_settings(path.join(root, "missing")), SettingsError);
  assert.throws(() => load_settings(settings(root, "无", "")), /右栏层名/);
});
test("UTF-8、换行和非 BMP 字符保持 Python 文本语义", (t) => {
  const root = temporary(t),
    file = path.join(root, "文本.txt");
  fs.writeFileSync(file, "\uFEFF中文😀\r\nnext\rthird\n");
  assert.equal(read_text(file), "\uFEFF中文😀\nnext\nthird\n");
  assert.deepEqual(split_lines("a\r\nb\rc\u2028d\x85"), ["a", "b", "c", "d"]);
  assert.deepEqual(split_lines(""), []);
  assert.deepEqual(split_lines("a\n\n"), ["a", ""]);
  fs.writeFileSync(file, Buffer.from([0xff]));
  assert.throws(() => read_text(file));
});
test("路径解析跟随软链后再处理父目录", (t) => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, "actual", "nested"), { recursive: true });
  try {
    fs.symlinkSync(
      path.join(root, "actual", "nested"),
      path.join(root, "alias"),
      "junction",
    );
  } catch (e) {
    if (process.platform === "win32" && e.code === "EPERM")
      return t.skip("无软链权限");
    throw e;
  }
  assert.equal(
    resolve_path(root, "alias/../new.md"),
    path.join(fs.realpathSync(root), "actual", "new.md"),
  );
});
test("名称、路径、接口关键字保留区分规则", () => {
  assert.deepEqual(classify_keyword("post /api/Login"), [
    "接口",
    "POST /api/Login",
  ]);
  assert.deepEqual(classify_keyword("./server/app/"), ["路径", "server/app"]);
  assert.deepEqual(classify_keyword("login()"), ["名称", "login"]);
  const anchor = {
    node: "N1.01",
    path: "server/app/login.py",
    line: 5,
    doc_line: 20,
    tokens: [
      { kind: "符号", value: "LoginService.login()" },
      { kind: "类型", type_word: "接口", value: "POST /api/login" },
    ],
  };
  const docs = [
    {
      path: "docs/链路全景/业务/登录.md",
      overview: null,
      submodules: [{ number: 1, name: "登录", anchors: [anchor] }],
    },
  ];
  for (const word of [
    "login",
    "LoginService.login()",
    "server/app",
    "post /api/login",
  ]) {
    assert.equal(find_refs(docs, [word]).length, 1);
  }
  assert.equal(find_refs(docs, ["POST /api/Login"]).length, 0);
  assert.equal(find_refs(docs, ["login", "server/app"]).length, 1);
  assert.deepEqual(render_refs(find_refs(docs, ["login"])), [
    docs[0].path,
    "  子模块 1：登录",
    "    N1.01  第 20 行  server/app/login.py:5  `LoginService.login()` `POST /api/login`",
    "命中 1 处",
  ]);
});
test("Git 子目录只返回自身的中文、删除和未跟踪文件", (t) => {
  const root = temporary(t);
  const git = (...args) => {
    const p = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(p.status, 0, p.stderr);
    return p.stdout;
  };
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "fixture");
  git("config", "core.autocrlf", "false");
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(path.join(root, "app", "源码.py"), "a\n");
  fs.writeFileSync(path.join(root, "outside.txt"), "x\n");
  git("add", ".");
  git(
    "-c",
    "core.hooksPath=" + path.join(root, "no-hooks"),
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "baseline",
  );
  fs.unlinkSync(path.join(root, "app", "源码.py"));
  fs.writeFileSync(path.join(root, "app", "Makefile"), "x");
  fs.writeFileSync(path.join(root, "outside.txt"), "changed");
  assert.deepEqual(git_changed_paths(path.join(root, "app")), [
    "Makefile",
    "源码.py",
  ]);
});
test("ESM 命令入口不受宿主 type=module 或空格安装目录影响", (t) => {
  const root = temporary(t),
    install = path.join(root, "skill 安装");
  fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
  fs.cpSync(
    fileURLToPath(new URL("../../scripts/", import.meta.url)),
    path.join(install, "scripts"),
    { recursive: true },
  );
  const command = path.join(install, "scripts", "chain.mjs");
  let result = spawnSync(process.execPath, [command, "refs", "nothing"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /未命中/);
  result = spawnSync(process.execPath, [command, "check"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /缺少项目设置/);
  result = spawnSync(process.execPath, [command, "refs"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
});
test("重命名必须同时返回旧路径和新路径，遵守当前目录边界", (t) => {
  const root = temporary(t);
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  git("init", "-q");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "fixture");
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(
    path.join(root, "sub", "old.py"),
    "def work():\n    return 1\n",
  );
  git("add", ".");
  git(
    "-c",
    "core.hooksPath=" + path.join(root, "no-hooks"),
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "initial",
  );
  git("mv", "sub/old.py", "sub/new.py");
  assert.deepEqual(git_changed_paths(path.join(root, "sub")), [
    "new.py",
    "old.py",
  ]);
  git("mv", "sub/new.py", "outside.py");
  assert.deepEqual(git_changed_paths(path.join(root, "sub")), ["old.py"]);
});
test("从 eval 导入 CLI 时不能误触发主入口", () => {
  const file = fileURLToPath(
    new URL("../../scripts/chain.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import {pathToFileURL} from 'node:url'; await import(pathToFileURL(process.argv[1])); console.log('imported');",
      file,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "imported\n");
  assert.equal(result.stderr, "");
});
test("Windows 的 POSIX 输入逐层识别 Junction，拒绝仓外目标", (t) => {
  const nativeSep = path.sep;
  path.sep = "\\";
  t.after(() => {
    path.sep = nativeSep;
  });
  for (const name of [
    "resolve",
    "parse",
    "isAbsolute",
    "dirname",
    "join",
    "relative",
  ])
    t.mock.method(path, name, path.win32[name]);
  t.mock.method(fs, "lstatSync", (file) => ({
    isSymbolicLink: () => file === "C:\\repo\\docs\\link",
  }));
  t.mock.method(fs, "readlinkSync", () => "D:\\external\\nested");
  assert.equal(
    resolve_path("C:\\repo", "docs/link/file.md"),
    "D:\\external\\nested\\file.md",
  );
  assert.equal(
    resolve_path("C:\\repo", "docs/link/../new.md"),
    "D:\\external\\new.md",
  );
});
test("关键字的 Python 空白语义保留 NEL 且不吞 BOM", () => {
  assert.deepEqual(classify_keyword("\x85login()\x85"), ["名称", "login"]);
  assert.deepEqual(classify_keyword("\uFEFFlogin()"), ["名称", "\uFEFFlogin"]);
});
