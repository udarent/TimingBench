// 场景与能力表：四类界面的差异**只由这张表回答**，不再散落成各处的 if。
//
// 一条界面的差异可以拆成两件事，必须分开管：
//   ① 画不画 / 能不能点 —— 能力（本文件）。回答「触摸卡片里应该有连线吗」这类问题。
//   ② 画多大、钉在哪  —— 布局（geometry.js + shapes.js 的派生计算）。回答「卡片要不要
//      等比缩放」「只读要不要裁掉顶部 HUD 区」。布局由内容与容器推导，不该进能力表，
//      否则「不画字符条」和「因此底部留 0 高」会被混成同一条规则。
//
// 场景只有两轴：**指针**（fine / coarse）× **读写**（Edit / View）。
// 「是不是嵌入卡片」不是第三轴，也不进这张表 —— 它只影响布局（等比 fit、裁顶部、按内容
// 算高）和 HUD 里那个「生成嵌入代码」图标（卡片里没意义）。曾经把「卡片」和「只读」当成
// 一回事，结果桌面卡片点进编辑后就落回 deskEdit，虽然行为碰巧正确，但表读起来是错的。
//
// 能力策略三态：
//   on   —— 本场景绘制，且是本场景的主要入口
//   off  —— 本场景不画，也不该有（没有它读者也不缺什么）
//   swap —— 本场景**换成另一套输入通道**。这是减法做不到的部分：手指没有 hover、
//           纵向拖拽会与原生滚动抢手势，所以字符条、行工具、拖拽把手在触摸端不是
//           「删掉」，而是分别换成固定停靠条、上下文条、↑↓ 图标。标成 swap 的地方
//           一定另有实现，读代码时不要以为漏了。
import { TOUCH } from './mode.js';

var ON = 'on', OFF = 'off', SW = 'swap';

export function sceneOf(state) {
  return (TOUCH ? 'touch' : 'desk') + (state && state.readonly ? 'View' : 'Edit');
}

export var CAP = {
  // 画布 HUD：撤销 / 重做 / 连线（/ 生成嵌入代码，卡片里去掉）
  hud:        { deskEdit: ON, deskView: OFF, touchEdit: ON, touchView: OFF },
  colhead:    { deskEdit: ON, deskView: OFF, touchEdit: ON, touchView: OFF },
  colAct:     { deskEdit: ON, deskView: OFF, touchEdit: SW,  touchView: OFF },
  rowTool:    { deskEdit: ON, deskView: OFF, touchEdit: SW,  touchView: OFF },
  rowDrag:    { deskEdit: ON, deskView: OFF, touchEdit: SW,  touchView: OFF },
  cellLabel:  { deskEdit: ON, deskView: OFF, touchEdit: SW,  touchView: OFF },
  laneMeta:   { deskEdit: ON, deskView: OFF, touchEdit: ON,  touchView: OFF },
  spacerMark: { deskEdit: ON, deskView: OFF, touchEdit: ON,  touchView: OFF },
  // 字符输入只剩一套实现：HTML 停靠条（`#chardock`）。桌面原来在 SVG 里画一条 23 颗的
  // 字符条（旧 `actionBar`），触摸端是固定停靠条 —— 同一件事两套渲染、两套布局、两套点击。
  // 现在统一为前者：桌面放得下 23 颗就全平铺，触摸放 4 颗 + `⋯`，这是**布局**差异
  // （宽度决定折叠），不是能力差异。顺带删掉了 SVG 字符条那段「滚动时反向位移把 chips
  // 钉回可视区」的历史包袱，以及 `charChips` 图元。
  dock:       { deskEdit: ON, deskView: OFF, touchEdit: ON,  touchView: OFF },
  tbpanel:    { deskEdit: SW, deskView: OFF, touchEdit: ON,  touchView: OFF }
};

// HUD 图标的顺序。之前这里是两句写死的 cmd()，外加一个 `if (!(T && embedCard))` 把
// 「连线」和「嵌入代码」一起摘掉。两张图标的去留其实各有理由，现在分开声明：
//   · 连线（◇）：四个场景全留。触摸卡片原本被顺带摘掉，可行/列动作表里没有 edge，
//     等于在触摸卡片里完全加不了连线 —— 这是漏，不是取舍。
//   · 嵌入代码（<>）：只在「触摸卡片」里去掉。卡片本身只有三四百像素宽，四个图标
//     就是 190px 的浮层；而「把这张卡片再嵌一次」在那里确实没有意义。桌面卡片保留
//     —— 边画边取片段是常见用法（工作台离得远时）。
var HUD_ITEMS = ['undo', 'redo', 'link', 'embed'];

export function hudCmds(scene, inCard) {
  if (!can('hud', scene)) return [];
  var dropEmbed = inCard && scene.indexOf('touch') === 0;
  return HUD_ITEMS.filter(function (c) { return !(c === 'embed' && dropEmbed); });
}

export function can(name, scene) {
  var v = CAP[name];
  return !!v && v[scene] === ON;
}

// 该能力在本场景是否「换了另一套实现」。目前只用于自检与文档对照，渲染层不用。
export function isSwap(name, scene) {
  var v = CAP[name];
  return !!v && v[scene] === SW;
}

// 业务动作的唯一清单：触摸端上下文条（#tbpanel）按这两组渲染，桌面端由行工具 / 列操作
// 直接画同名动作。动作名 → 图标 / 英文名在 touch.js，动作本身由 interactions.js 执行，
// 三处共用这一份清单，避免「面板里少一个动作」与「图元里多一个按钮」各说各话。
export var ACTS = {
  row: ['name', 'wave', 'data', 'nodeStr', 'phase', 'period', 'up', 'down', 'add', 'spacer', 'del'],
  col: ['insert', 'delete', 'gap', 'append']
};
