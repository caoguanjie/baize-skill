import { place_at, render_detail } from "../scripts/chain_layout.mjs";

const left = [
  "检查资料 [N1.01]",
  "    |",
  "    +-------------------------+",
  place_at("    |", "|", 30),
  place_at("    v", "v", 30),
  place_at("资料齐全", "缺少资料", 30),
  place_at("    | 保存完成", "| 等待补录", 30),
  place_at("    v", "v", 30),
  place_at("==> 子模块 2", "( 本次不提交 )", 30),
];
const cards = {
  "N1.01": ["应用层", ["方法：validate()", "动作：校验本次输入"]],
};
console.log(render_detail("子模块 1：资料检查", left, cards));
