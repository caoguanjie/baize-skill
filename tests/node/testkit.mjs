"use strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import cp from "node:child_process";
import { parse_doc } from "../../scripts/chain_doc.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
const FILES = {
  "api/openapi.json": '{"paths": {"/api/login": {"post": {}}}}\n',
  "docs/链路全景/README.md":
    "# 链路全景\n\n[登录](业务/登录.md) [订单](业务/订单/README.md) [卡片](能力/消息通知.md)\n\n## 交叉表\n\n<!-- chain:cross-table:start -->\n| 类型 | 名称 | 登录 | 订单 |\n| --- | --- | --- | --- |\n| 能力 | 消息通知 | - | 调用 |\n| 表 | app_user | 读写 | 读 |\n<!-- chain:cross-table:end -->\n",
  "docs/链路全景/业务/登录.md":
    "# 登录\n\n> 最后核对：2026-09-30\n\n## 总览\n\n```text\n[1] 发码\n  | 手机号\n  v\n[2] 会话\n```\n\n| 子模块 | 做什么 | 入口 | 交给下一步 |\n| --- | --- | --- | --- |\n| [1] 发码 | 下单 | web/src/views/Login.vue:8 `handleQuickLogin()` | 会话 |\n| [2] 会话 | 建立会话 | server/app/login.py:2 `LoginService.login_or_register()` | 完成 |\n\n## 子模块 1：发码\n\n```text\n+-------------------------------------------------------------------------------------------------+\n|                                          子模块 1：发码                                           |\n+-------------------------------------------------------------------------------------------------+\n| 业务流程与分支                                      | 实现分层与代码入口                              |\n+--------------------------------------------------+----------------------------------------------+\n| 步骤 [N1.01]                                      | +------------------------------------------+ |\n| 调用 [N1.02]                                      | | [N1.01] 页面层                            | |\n| ==> 子模块 2：会话                                 | | 按钮：.quick-login                        | |\n|                                                  | | 方法：handleQuickLogin()                  | |\n|                                                  | +------------------------------------------+ |\n|                                                  |                                              |\n|                                                  | +------------------------------------------+ |\n|                                                  | | [N1.02] 接口层                            | |\n|                                                  | | 方法：AuthApis.Auth.authLogin()           | |\n|                                                  | | 方法：login()                             | |\n|                                                  | | 接口：POST /api/login                     | |\n|                                                  | +------------------------------------------+ |\n+--------------------------------------------------+----------------------------------------------+\n```\n\n### 对应源码入口\n\n| 节点 | 文件入口 | 精确定位 |\n| --- | --- | --- |\n| N1.01 | web/src/views/Login.vue:3 | 按钮 `.quick-login` |\n| N1.01 | web/src/views/Login.vue:8 | `handleQuickLogin()` |\n| N1.02 | web/src/store/auth.ts:3 | `AuthApis.Auth.authLogin()`；接口 `POST /api/login` |\n| N1.02 | server/app/login.py:5 | `login()` |\n\n## 子模块 2：会话\n\n```text\n+-------------------------------------------------------------------------------------------------+\n|                                          子模块 2：会话                                           |\n+-------------------------------------------------------------------------------------------------+\n| 业务流程与分支                                      | 实现分层与代码入口                              |\n+--------------------------------------------------+----------------------------------------------+\n| 应用 [N2.01]                                      | +------------------------------------------+ |\n| 数据 [N2.02]                                      | | [N2.01] 应用层                            | |\n| 状态 [N2.03]                                      | | 方法：LoginService.login_or_register()    | |\n|                                                  | +------------------------------------------+ |\n|                                                  |                                              |\n|                                                  | +------------------------------------------+ |\n|                                                  | | [N2.02] 数据层                            | |\n|                                                  | | 表：app_user 读写                          | |\n|                                                  | +------------------------------------------+ |\n|                                                  |                                              |\n|                                                  | +------------------------------------------+ |\n|                                                  | | [N2.03] 状态层                            | |\n|                                                  | | 方法：commitSession()                     | |\n|                                                  | +------------------------------------------+ |\n+--------------------------------------------------+----------------------------------------------+\n```\n\n### 对应源码入口\n\n| 节点 | 文件入口 | 精确定位 |\n| --- | --- | --- |\n| N2.01 | server/app/login.py:2 | `LoginService.login_or_register()` |\n| N2.02 | server/app/models.py:2 | 表 `app_user` 读写 |\n| N2.03 | web/src/store/auth.ts:6 | `commitSession()` |\n",
  "docs/链路全景/业务/订单/01-下单.md":
    "# 模块 1：下单\n\n## 总览\n\n```text\n[1] 建单\n```\n\n| 子模块 | 做什么 | 入口 | 交给下一步 |\n| --- | --- | --- | --- |\n| [1] 建单 | 执行 | server/app/orders/confirm.py:1 `confirm_order()` | 下一步 |\n\n## 子模块 1：建单\n\n```text\n+-------------------------------------------------------------------------------------------------+\n|                                          子模块 1：建单                                           |\n+-------------------------------------------------------------------------------------------------+\n| 业务流程与分支                                      | 实现分层与代码入口                              |\n+--------------------------------------------------+----------------------------------------------+\n| 建单 [N1.01]                                      | +------------------------------------------+ |\n| ==> 模块：支付 / 扣款                               | | [N1.01] 应用层                            | |\n|                                                  | | 方法：confirm_order()                     | |\n|                                                  | | 组件：OrderSummary                        | |\n|                                                  | +------------------------------------------+ |\n+--------------------------------------------------+----------------------------------------------+\n```\n\n### 对应源码入口\n\n| 节点 | 文件入口 | 精确定位 |\n| --- | --- | --- |\n| N1.01 | server/app/orders/confirm.py:1 | `confirm_order()` |\n| N1.01 | web/src/ui/registry.ts:1 | `OrderSummary` |\n",
  "docs/链路全景/业务/订单/02-支付.md":
    "# 模块 2：支付\n\n## 总览\n\n```text\n[1] 扣款\n```\n\n| 子模块 | 做什么 | 入口 | 交给下一步 |\n| --- | --- | --- | --- |\n| [1] 扣款 | 执行 | server/app/payment.py:3 `charge_payment()` | 下一步 |\n\n## 子模块 1：扣款\n\n```text\n+-------------------------------------------------------------------------------------------------+\n|                                          子模块 1：扣款                                           |\n+-------------------------------------------------------------------------------------------------+\n| 业务流程与分支                                      | 实现分层与代码入口                              |\n+--------------------------------------------------+----------------------------------------------+\n| 扣款 [N1.01]                                      | +------------------------------------------+ |\n| 读取 [N1.02]                                      | | [N1.01] 服务层                            | |\n| 发布 [N1.03]                                      | | 方法：charge_payment()                    | |\n| 能力 [N1.04]                                      | +------------------------------------------+ |\n| ==> 能力：消息通知                                  |                                              |\n|                                                  | +------------------------------------------+ |\n|                                                  | | [N1.02] 数据层                            | |\n|                                                  | | 表：app_user 读                           | |\n|                                                  | +------------------------------------------+ |\n|                                                  |                                              |\n|                                                  | +------------------------------------------+ |\n|                                                  | | [N1.03] 异步层                            | |\n|                                                  | | 方法：publish()                           | |\n|                                                  | | 事件：order.payment.requested 发布         | |\n|                                                  | +------------------------------------------+ |\n|                                                  |                                              |\n|                                                  | +------------------------------------------+ |\n|                                                  | | [N1.04] 能力                              | |\n|                                                  | | 动作：交给能力                              | |\n|                                                  | +------------------------------------------+ |\n+--------------------------------------------------+----------------------------------------------+\n```\n\n### 对应源码入口\n\n| 节点 | 文件入口 | 精确定位 |\n| --- | --- | --- |\n| N1.01 | server/templates/receipt.md | 支付回执模板 |\n| N1.01 | server/app/payment.py:3 | `charge_payment()` |\n| N1.02 | server/app/models.py:2 | 表 `app_user` 读 |\n| N1.03 | server/app/payment.py:6 | `publish()` |\n| N1.03 | server/app/payment.py:1 | 事件 `order.payment.requested` 发布 |\n| N1.04 | docs/链路全景/能力/消息通知.md | 能力 `消息通知` 调用 |\n",
  "docs/链路全景/业务/订单/README.md":
    "# 订单\n\n## 总览\n\n```text\n[1] 下单\n  | 任务创建\n  v\n[2] 支付\n```\n\n| 模块 | 做什么 | 入口 | 交给下一步 | 文档 |\n| --- | --- | --- | --- | --- |\n| [1] 下单 | 建单 | server/app/orders/confirm.py:1 `confirm_order()` | 下一步 | [01-下单.md](01-下单.md) |\n| [2] 支付 | 扣款 | server/app/payment.py:3 `charge_payment()` | 完成 | [02-支付.md](02-支付.md) |\n",
  "docs/链路全景/能力/消息通知.md":
    "# 消息通知\n\n## 总览\n\n```text\n[1] 下发\n```\n\n| 子模块 | 做什么 | 入口 | 交给下一步 |\n| --- | --- | --- | --- |\n| [1] 下发 | 执行 | web/src/ui/registry.ts:1 `registry` | 下一步 |\n\n## 子模块 1：下发\n\n```text\n+-------------------------------------------------------------------------------------------------+\n|                                          子模块 1：下发                                           |\n+-------------------------------------------------------------------------------------------------+\n| 业务流程与分支                                      | 实现分层与代码入口                              |\n+--------------------------------------------------+----------------------------------------------+\n| 下发 [N1.01]                                      | +------------------------------------------+ |\n|                                                  | | [N1.01] 组件层                            | |\n|                                                  | | 方法：registry                            | |\n|                                                  | +------------------------------------------+ |\n+--------------------------------------------------+----------------------------------------------+\n```\n\n### 对应源码入口\n\n| 节点 | 文件入口 | 精确定位 |\n| --- | --- | --- |\n| N1.01 | web/src/ui/registry.ts:1 | `registry` |\n",
  "server/app/login.py":
    "class LoginService:\n    async def login_or_register(self, phone):\n        return phone\n\nasync def login(body):\n    return body\n",
  "server/app/models.py": 'class User:\n    __tablename__ = "app_user"\n',
  "server/app/orders/confirm.py": "def confirm_order():\n    pass\n",
  "server/app/payment.py":
    'EVENT = "order.payment.requested"\n\ndef charge_payment():\n    pass\n\ndef publish():\n    pass\n',
  "server/templates/receipt.md": "支付回执模板\n",
  "web/src/store/auth.ts":
    "\nexport async function sendCode(phone: string) {\n  return AuthApis.Auth.authLogin(phone)\n}\n\nexport function commitSession() {\n}\n",
  "web/src/ui/registry.ts": "export const registry = { OrderSummary: 1 }\n",
  "web/src/views/Login.vue":
    '\n<div>\n<button class="quick-login" @click="handleQuickLogin">\n</div>\n<script>\n// login\n// ready\nfunction handleQuickLogin() {\n}\n',
};
const SETTINGS =
  "# 项目设置\n\n| 设置 | 值 | 谁用 |\n| --- | --- | --- |\n| 项目形态 | 前后端都有 | AI |\n| 接口契约 | `api/openapi.json` | 脚本 |\n| 右栏层名 | 页面层、组件层、状态层、接口层、应用层、服务层、数据层、异步层 | 脚本 |\n| 卡片扩展字段 | 组件 | 脚本 |\n";
function put(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}
function git(root, ...args) {
  const r = cp.spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (r.error || r.status) throw r.error || new Error(r.stderr);
  return r.stdout.trim();
}
function make_temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "chain-node-"));
}
function build_repo() {
  const base = make_temp(),
    root = path.join(base, "repo");
  fs.mkdirSync(root);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "core.hooksPath", path.join(base, "empty-hooks"));
  git(root, "config", "core.autocrlf", "false");
  git(root, "config", "commit.gpgsign", "false");
  for (const [name, text] of Object.entries(FILES)) put(root, name, text);
  const settings = put(base, "skill/references/项目设置.md", SETTINGS);
  const repo = {
    root,
    settings,
    base,
    write: (rel, text) => put(root, rel, text),
    read: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
    edit(rel, old, value, count = 1) {
      let text = this.read(rel);
      if (!text.includes(old)) throw new Error("Missing fixture text: " + old);
      while (count-- > 0 && text.includes(old))
        text = text.replace(old, () => value);
      put(root, rel, text);
    },
    commit(message = "更新") {
      git(root, "add", ".");
      git(root, "commit", "-qm", message);
    },
    doc(rel) {
      return parse_doc(root, rel);
    },
    run(...args) {
      const cli = pathToFileURL(
        fileURLToPath(new URL("../../scripts/chain.mjs", import.meta.url)),
      ).href;
      const code =
        "import {main} from " +
        JSON.stringify(cli) +
        ";process.exitCode=main(" +
        JSON.stringify(args) +
        "," +
        JSON.stringify(settings) +
        ");";
      const result = cp.spawnSync(
        process.execPath,
        ["--input-type=module", "-e", code],
        { cwd: root, encoding: "utf8" },
      );
      return [result.status, result.stdout + result.stderr];
    },
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
  repo.commit("初始");
  return repo;
}
const L = "docs/链路全景/业务/登录.md",
  M1 = "docs/链路全景/业务/订单/01-下单.md",
  M2 = "docs/链路全景/业务/订单/02-支付.md",
  MR = "docs/链路全景/业务/订单/README.md";
export { FILES, SETTINGS, put, git, make_temp, build_repo, L, M1, M2, MR };
