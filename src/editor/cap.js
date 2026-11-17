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
  // 画布 HUD：撤销 / 重做 / 分屏方向 / 生成嵌入代码（卡片里去掉）。
  // 连线按钮在 0.9.17 从 HUD 移到底部上下文条（与 label / node 同排），见 ACTS。
  hud:        { deskEdit: ON, deskView: OFF, touchEdit: ON, touchView: OFF },
  colhead:    { deskEdit: ON, deskView: OFF, touchEdit: ON, touchView: OFF },
  // 列操作 / 行工具在画布上**没有渲染实现**了（0.15.1 删净：`colBtn` / `rowTools` 连同行内
  // 命中分支与 CSS 一起消失）。两者都收进下面同一个上下文条，选中行 / 列时出现。
  // 它们原来占的那条右侧带子（`ACT_W = 196px`）也随之在 0.15.2 收到 0 —— 画布宽度现在只
  // 贴合内容右缘，小视口下不再多出一段能横向滚过去的空白。
  // 这两项仍留在表里，是两个理由：① 记录「画布上不画、改由谁承担」这个去向，后来人不必
  // 从 git 历史里考古；② 让下面 `editEntries` 的「只读不泄漏编辑入口」检查继续覆盖它们 ——
  // 真有人把行工具加回去，只读卡片那条断言立刻会红。
  colAct:     { deskEdit: SW,  deskView: OFF, touchEdit: SW,  touchView: OFF },
  rowTool:    { deskEdit: SW,  deskView: OFF, touchEdit: SW,  touchView: OFF },
  // 行首拖拽把手（`rowDrag`）已在 0.9.13 删净 —— 图元、命中分支、拖拽结算一起走，
  // 行重排的唯一通道是上下文条的 ↑ / ↓（键盘 `Ctrl+↑↓` 等价）。
  // 数据标签的 ✎ 徽标（旧 `cellLabel`）已在 0.9.12 删净：13×11 命中区手指点不中、且靠
  // hover 显形，只有桌面能用 —— 于是「改单格标签」曾是桌面独有。现在四场景共用上下文条
  // （`ACTS.cell`），`B` 快捷键属于叠加的快捷方式、不进这张表。
  laneMeta:   { deskEdit: ON, deskView: OFF, touchEdit: ON,  touchView: OFF },
  spacerMark: { deskEdit: ON, deskView: OFF, touchEdit: ON,  touchView: OFF },
  // 字符输入只剩一套实现：HTML 停靠条（`#chardock`）。桌面原来在 SVG 里画一条 23 颗的
  // 字符条（旧 `actionBar`），触摸端是固定停靠条 —— 同一件事两套渲染、两套布局、两套点击。
  // 现在统一为前者，并按**实际可用宽度**折叠：宽屏（含宽屏触摸 / 宽嵌卡片）一次铺满全部
  // 字符，窄屏才把放不下的收进 `⋯`。这是**布局**差异（宽度决定折叠），不是能力差异。
  // 顺带删掉了 SVG 字符条那段「滚动时反向位移把 chips 钉回可视区」的历史包袱，以及
  // `charChips` 图元。
  dock:       { deskEdit: ON, deskView: OFF, touchEdit: ON,  touchView: OFF },
  // 上下文条：四场景同一套图标（触摸钉底部、桌面钉右侧），是行 / 列动作的唯一入口。
  tbpanel:    { deskEdit: ON, deskView: OFF, touchEdit: ON,  touchView: OFF },
  // 就地编辑：四场景同一语义 —— 「在格子上开一个小输入框改这一个值」，桌面双击、触摸双敲。
  // 触摸端额外支持长按 480ms，但那是**叠加**不是替代：桌面没有长按的对应物（鼠标按住
  // 不动没有意义），所以它不进这张表，也就不构成 swap。
  inlineEdit: { deskEdit: ON, deskView: OFF, touchEdit: ON,  touchView: OFF }
};

// HUD 图标的顺序。之前这里是两句写死的 cmd()，外加一个 `if (!(T && embedCard))` 把
// 「连线」和「嵌入代码」一起摘掉。两张图标的去留其实各有理由，现在分开声明：
//   · 连线（◇）：0.9.17 从 HUD 移到底部上下文条（与 label / node 同排，见 ACTS），
//     四场景统一走动作行，不再占顶栏。触摸卡片因此也能连线（旧实现里被顺带摘掉了）。
//   · 视图（view）：三段分段控件「图形 / 代码 / 双栏」，决定哪几个 pane 在。嵌入卡片里
//     也要显示 —— 卡片进编辑后能切到代码视图是它的核心用途（0.23.0 加）。
//   · 嵌入代码（<>）：只在「触摸卡片」里去掉。卡片本身只有三四百像素宽，四个图标
//     就是 190px 的浮层；而「把这张卡片再嵌一次」在那里确实没有意义。桌面卡片保留
//     —— 边画边取片段是常见用法（工作台离得远时）。
var HUD_ITEMS = ['undo', 'redo', 'layout', 'view', 'embed'];

export function hudCmds(scene, inCard) {
  if (!can('hud', scene)) return [];
  // 嵌入卡片只显示画布一个 pane，「分屏方向」永远没有意义 → 一律去掉。
  // 「视图切换」反过来：编辑态的卡片必须能用它切到代码，所以保留（scene 是 Edit 时 hud 才开）。
  // 「把这张卡片再嵌一次」只在触摸卡片里没意义（三四百像素宽），桌面卡片保留。
  var touchCard = inCard && scene.indexOf('touch') === 0;
  return HUD_ITEMS.filter(function (c) {
    if (c === 'layout') return !inCard;
    if (c === 'embed') return !touchCard;
    return true;
  });
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

// 业务动作的唯一清单：上下文条（#tbpanel）按 row / col 两组渲染，字符停靠条（#chardock）
// 按 dock 一组渲染左侧那三个格级动作。动作名 → 图标 / 英文名在 touch.js，动作本身由
// interactions.js 执行，三处共用这一份清单，避免「面板里少一个动作」与「图元里多一个按钮」各说各话。
export var ACTS = {
  // group / spanUp / spanDown 是「分组」这一组动作：group 按当前**行范围**归组（输入组名，
  // 可用 / 嵌套，清空 = 退出这一层）；spanUp / spanDown 把范围向外推一行 —— 触摸端没有
  // Shift，这是它唯一能表达「一段连续行」的方式（桌面另有 Shift+点行名 / Shift+↑↓）。
  row: ['name', 'wave', 'data', 'nodeStr', 'phase', 'period', 'up', 'down', 'add', 'spacer', 'del',
        'group', 'spanUp', 'spanDown', 'link'],
  col: ['insert', 'delete', 'gap', 'append', 'link'],
  // 格级：作用对象是「某一个格子」而不是整行 / 整列。行级的 data / nodeStr 改的是整行
  // 全部标签 / 整行锚点串；这两项才是「只改这一格」。
  // **0.18.0 从上下文条挪到字符停靠条左侧**：它们和字符一样「只在选中格子时才有意义」，
  // 放同一行既省掉一整行常驻，也让「点格子 → 改这一格」的工具聚在一处。
  // link 同时留在 row / col 组里 —— 选中整行 / 整列时也要能起手连线，而停靠条那时不显示。
  dock: ['label', 'node', 'link']
};
