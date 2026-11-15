// 编辑器布局常量：主画布与候选字符条共用的几何参数。
// fine 指针沿用参考版式；coarse 指针整组放大到可点按尺寸（≥44 CSS px 的命中区）。
// 模式在模块求值时确定，import 本文件后再读取 G.* 的模块拿到的是同一份结果。
import { Core } from '../core/ir.js';
import { TOUCH } from './mode.js';

export const G = {
  CELL:      TOUCH ? 48 : 38,
  // 行名区宽度与波形起点在运行时**按内容自适应**（shapes.js 每次 redraw 重算并写回
  // G.NAME_W / G.XS），这里的值只是首帧兜底。算法：
  //   NAME_W = 8·⌈clamp(64, 上限, leftBound + 最宽行名 + 16) / 8⌉，leftBound = PAD +（桌面编辑态 ? 18 : 0）
  //   XS     = NAME_W + 8
  // 量化到 8px 且只向上取整：改名不再逐像素推动波形，又不至于把行名压出画布。
  // 只读态与触摸端不画拖拽把手，左界就只剩 PAD —— 名字短时行名区自然更窄。
  NAME_W:    TOUCH ? 96 : 104,
  ROW_H:     TOUCH ? 60 : 48,
  TOP:       TOUCH ? 44 : 36,
  PAD:       16,
  ACT_W:     TOUCH ? 24 : 196,   // 触摸端行工具改由操作栏承担，画布右侧不再留 196px
  COL_Y:     TOUCH ? 8 : 6,
  ACT_H:     40,
  CHIP_W:    TOUCH ? 44 : 28,
  CHIP_H:    TOUCH ? 44 : 26,
  CHIP_STEP: TOUCH ? 48 : 30,
  // 波形起点：首帧兜底值 = 上面的 NAME_W + 8，同样在 redraw 里按内容重算。
  XS:        TOUCH ? 104 : 112
};

// 桌面单行字符条的最小画布宽度；触摸端字符条换行，不再用它撑宽画布。
G.CHIPS_W = G.XS + Core.ALL.length * G.CHIP_STEP + 16;

// ---- 行级时间标尺（period / phase）----------------------------------------
// WaveJSON 的 period / phase 是**行级**的：上游 parse-wave-lanes.js 里
//   lane.period = sigx.period || 1            → 每个字符拆成 2·period 个 half-brick
//   lane.phase  = (sigx.phase || 0) * 2       → 再逐 half-brick 从行首 shift 掉
// 于是：period 把该行的每个字符横向拉长 period 倍（period=1 时一格是 2 个 half-brick）；
// phase 把整行墨迹**连续**左移 phase 个周期 —— 位移量本身没有量化，half-brick 粒度只体现在
// 「行首被整块丢掉多少」上（详见 laneShift / laneLeadTrim 的注释与 CHANGELOG 0.12.3 的实测表）。
// 我们只在**绘制层**引入这套标尺：IR 里 tick 仍是「这一行自己的字符序号」，
// 因此编辑语义（点哪一格改哪个字符、增删列、node 锚点、edge 端点）全都不变。
export function lanePeriod(l){
  var p=Number(l&&l.period);
  return (isFinite(p)&&p>=1) ? Math.round(p) : 1;
}
// 该行墨迹相对参考网格的左移量，单位是「周期」。**连续值，不做任何量化**。
// 上游 wavedrom 的相位是「两步凑出来的连续位移」，很容易误读成量化（我们先后误读过两次）：
//   ① `parse-wave-lanes.js`：`lane.phase = sigx.phase * 2`（半砖数）；`parse-wave-lane.js` 里
//      `for (i=0; i<lane.phase; i+=1) R.shift()` —— 从行首**整块**丢掉 `ceil(2·phase)` 个半砖
//      （loop 判据是 `i < phase`，所以非整数时等于向上取整）；
//   ② `render-wave-lane.js` 再把剩下的整组右移 `(ceil(2·phase) − 2·phase)` 个半砖做补偿：
//          xoffset = Math.ceil(2*phase) - 2*phase;  tt(xoffset * lane.xs, 0, …)
// 净位移 = `ceil(2p)·半砖 − (ceil(2p) − 2p)·半砖 = 2p·半砖 = p 个周期` —— **精确等于 phase**。
// 实测（wavedrom@3.5.0 浏览器包，砖宽 20px、一格 40px）：phase 0.1 → translate(16)、0.2 → 12、
// 0.3 → 8、0.5 → 0，折算下来每 0.1 相位正好移动 4px = 0.1 格。所以 0.1 与 0.2 **确实不同**。
// 半砖粒度只体现在「行首被整块丢掉多少」上（见 laneLeadTrim），不体现在位移量上。
export function laneShift(l){
  var p=Number(l&&l.phase);
  return (isFinite(p)&&p>0) ? p : 0;
}
// 行首要被丢掉的半砖（换算成「周期」）：上游是整块 shift 出去的，不画半块。
// 所以相位行的波形并不是「整体左移 + 靠容器裁掉」，而是「先丢掉 ceil(2p) 个半砖，再右移补偿」——
// 结果是在左边缘留下 `(ceil(2p) − 2p)/2` 个周期的空白，再往外才是波形。
export function laneLeadTrim(l){
  var p=Number(l&&l.phase);
  if(!isFinite(p)||p<=0) return 0;
  return (Math.ceil(p*2)-p*2)/2;
}
// 这一行要画多少个字符格：自身字符数与「补齐到全图参考宽度」取大。
// period=1 时恒等于 ticks（与改造前完全一致）；period=2 时补一半。
export function laneChars(l,ticks){
  var p=lanePeriod(l), own=l.slots?l.slots.length:0;
  return Math.max(own, Math.ceil(ticks/p));
}
// 行内第 tick 个字符格的几何（读 G.XS / G.CELL 的实时值，redraw 会先写回）：
//   x0 未裁剪的起点（phase 行会落在波形起点左侧，且是**小数** —— 相位是连续位移，
//   格子、字形、标签、edge 端点都跟着它走，才不会出现「波移了、可点区没移」），w 格宽，cx 中心。
export function cellGeo(l,tick){
  var p=lanePeriod(l), sh=laneShift(l), w=p*G.CELL;
  var x0=G.XS+(tick*p-sh)*G.CELL;
  return {x0:x0, w:w, cx:x0+w/2};
}

