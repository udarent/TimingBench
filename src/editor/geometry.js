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
// 于是：period 把该行的每个字符横向拉长 period 倍；phase 把整行墨迹左移 phase 个周期
// （phase 以 half-brick 计，非整数时上游等价于向上取整到半个周期）。
// 我们只在**绘制层**引入这套标尺：IR 里 tick 仍是「这一行自己的字符序号」，
// 因此编辑语义（点哪一格改哪个字符、增删列、node 锚点、edge 端点）全都不变。
export function lanePeriod(l){
  var p=Number(l&&l.period);
  return (isFinite(p)&&p>=1) ? Math.round(p) : 1;
}
// 该行墨迹相对参考网格的左移量，单位是「周期」，恒为 0.5 的整数倍。
export function laneShift(l){
  var p=Number(l&&l.phase);
  return (isFinite(p)&&p>0) ? Math.ceil(p*2)/2 : 0;
}
// 这一行要画多少个字符格：自身字符数与「补齐到全图参考宽度」取大。
// period=1 时恒等于 ticks（与改造前完全一致）；period=2 时补一半。
export function laneChars(l,ticks){
  var p=lanePeriod(l), own=l.slots?l.slots.length:0;
  return Math.max(own, Math.ceil(ticks/p));
}
// 行内第 tick 个字符格的几何（读 G.XS / G.CELL 的实时值，redraw 会先写回）：
//   x0 未裁剪的起点（phase 行可能落在波形起点左侧），w 格宽，cx 中心。
export function cellGeo(l,tick){
  var p=lanePeriod(l), sh=laneShift(l), w=p*G.CELL;
  var x0=G.XS+(tick*p-sh)*G.CELL;
  return {x0:x0, w:w, cx:x0+w/2};
}

