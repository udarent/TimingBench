// 编辑器布局常量：主画布与候选字符条共用的几何参数。
// fine 指针沿用参考版式；coarse 指针整组放大到可点按尺寸（≥44 CSS px 的命中区）。
// 模式在模块求值时确定，import 本文件后再读取 G.* 的模块拿到的是同一份结果。
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
  // 画布右侧的控件预留宽（`W = ACT_X + ACT_W + PAD`）。桌面原来留 196px 给行末那排
  // 「~ = ◇ + ∅ ✕」行工具与列头按钮 —— 两者 0.15.1 已连渲染函数一起删除，那块区域什么都不画，
  // 留着只会让画布比内容宽出一截、在小视口里变成一段能横向滚过去的空白。现在收到 0：
  // 画布宽度贴合内容右缘（= 只读态 roW 的口径），宽屏下仍由 viewW 撑满容器。
  ACT_W:     TOUCH ? 24 : 0,
  COL_Y:     TOUCH ? 8 : 6,
  CHIP_W:    TOUCH ? 44 : 28,
  CHIP_H:    TOUCH ? 44 : 26,
  // 波形起点：首帧兜底值 = 上面的 NAME_W + 8，同样在 redraw 里按内容重算。
  XS:        TOUCH ? 104 : 112
};

// ---- 行级时间标尺（period / phase）----------------------------------------
// WaveJSON 的 period / phase 是**行级**的：上游 parse-wave-lanes.js 里
//   lane.period = sigx.period || 1            → 每个字符拆成 2·period 个 half-brick
//   lane.phase  = (sigx.phase || 0) * 2       → 再逐 half-brick 从行首 shift 掉
// 于是：period 把该行的每个字符横向拉长 period 倍（period=1 时一格是 2 个 half-brick）；
// phase 把整行墨迹**连续**左移 phase 个周期 —— 位移量本身没有量化，half-brick 粒度只体现在
// 「上游行首被整块丢掉多少」上（我们不做这一步，见 laneShift 的注释；CHANGELOG 0.12.3 有实测表）。
// 我们只在**绘制层**引入这套标尺：IR 里 tick 仍是「这一行自己的字符序号」，
// 因此编辑语义（点哪一格改哪个字符、增删列、node 锚点、edge 端点）全都不变。
export function lanePeriod(l){
  var p=Number(l&&l.period);
  return (isFinite(p)&&p>=1) ? Math.round(p) : 1;
}
// 该行墨迹相对参考网格的左移量，单位是「周期」。**连续值，不做任何量化**。
// （**只对齐结果，不复刻手段**：上游把位移拆成「整块丢砖 + 分数补偿」两步，是为了让砖块保持
//   半砖对齐；我们按字符格直接绘制，没有砖的概念，所以只要位移量等于 phase 个周期就够了。
//   由此产生的一处**有意差异**：上游会真的丢掉行首 ceil(2p) 个半砖（phase 0.1 时前 0.4 格
//   波形直接消失），我们把波形完整画出来、只把越过波形起点的部分裁掉 —— 不丢信息。
//   别把这条当 bug 改回「留白」，那是在复刻上游的实现副作用。）
// 上游 wavedrom 的相位是「两步凑出来的连续位移」，很容易误读成量化（我们先后误读过两次）：
//   ① `parse-wave-lanes.js`：`lane.phase = sigx.phase * 2`（半砖数）；`parse-wave-lane.js` 里
//      `for (i=0; i<lane.phase; i+=1) R.shift()` —— 从行首**整块**丢掉 `ceil(2·phase)` 个半砖
//      （loop 判据是 `i < phase`，所以非整数时等于向上取整）；
//   ② `render-wave-lane.js` 再把剩下的整组右移 `(ceil(2·phase) − 2·phase)` 个半砖做补偿：
//          xoffset = Math.ceil(2*phase) - 2*phase;  tt(xoffset * lane.xs, 0, …)
// 净位移 = `ceil(2p)·半砖 − (ceil(2p) − 2p)·半砖 = 2p·半砖 = p 个周期` —— **精确等于 phase**。
// 实测（wavedrom@3.5.0 浏览器包，砖宽 20px、一格 40px）：phase 0.1 → translate(16)、0.2 → 12、
// 0.3 → 8、0.5 → 0，折算下来每 0.1 相位正好移动 4px = 0.1 格。所以 0.1 与 0.2 **确实不同**。
// 半砖粒度只体现在「上游行首被整块丢掉多少」上，不体现在位移量上。
// **负值有效**：上游 `render-wave-lane.js` 的 xoffset 是分支的 ——
//   `xoffset = (p > 0) ? (ceil(2p) - 2p) : (-2p)`
// 正值走「丢整砖 + 分数补偿」，负值直接取 `-2p`（整块右移，不吞整数部分）。
// 两条分支折算下来都是**净位移 = phase 个周期**，只是一个往左一个往右 —— 完全对称。
// 所以这里不再把负值抹成 0，直接返回原值（`isFinite` 挡住 null / NaN / 字符串）。
export function laneShift(l){
  var p=Number(l&&l.phase);
  return isFinite(p) ? p : 0;
}
// 相位尺（图形化改 phase）的两个参数：
//   PHASE_STEP 拖动 / 方向键的吸附步长。取 0.05 —— 一格 38px 时 = 1.9px，够细且不会让
//     指针稍微一抖就跳 0.1；要更细的精确值仍可点 ψ 徽标走文本输入。
//   PHASE_MAX  可调范围的**上限**（往左移）。相位超过 4 个周期没有实际用途（波形整体移出画布）。
//   PHASE_MIN  对称的**下限**（往右移，负相位）。上游对负值同样支持，且不吞整数部分，
//              所以这里取对称区间 [-4, +4] —— 拖到两端时波形正好整行移出可视区。
export const PHASE_STEP = 0.05;
export const PHASE_MAX = 4;
export const PHASE_MIN = -PHASE_MAX;

// ---- config.hscale ---------------------------------------------------------
// WaveJSON 的 `config.hscale` 是**全局横向倍率**：上游把它塞进 `extra = period*hscale - 1`，
// 于是每个字符占 `period·hscale` 个砖、格线每 `hscale` 个砖一条 —— 净效果就是把整个横轴
// 放大 hscale 倍，行高与字号不动。我们照这个「结果」做：格宽 = 基准格宽 × hscale，
// 其余一切（列宽、相位尺、命中区、edge 端点）都从格宽派生，所以只改这一处即可。
// 上限取 8 而不是上游的 100：hscale 是给「打印 / 贴图」用的，100 倍在这里等于一格 3800px，
// 画布只剩横向滚动，编辑器没法用了。超出上限按上限画（源码里的值不动）。
// 非整数按上游口径四舍五入（`Math.round`），0 / 负数 / 非数字 → 1。
export const HSCALE_MAX = 8;
export function hscaleOf(ir){
  var n = ir && ir.config ? Number(ir.config.hscale) : 1;
  if(!isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.min(HSCALE_MAX, Math.round(n)));
}

// 这一行要画多少个字符格：自身字符数与「补齐到全图参考宽度」取大。// period=1 时恒等于 ticks（与改造前完全一致）；period=2 时补一半。
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


// 缩放的倍数上下限（相对布局算出的 fit 基数）。
//   · 上限 4×：再大就只是在放大矢量、没有更多信息，且一屏只剩两三个格子。
//   · 下限**不是常量**：交给布局层算「整张图刚好装进视口」所需的比例（见 shapes.js 的
//     state.zoomMin），再兜一个绝对底 0.2 防止极端文档把内容缩成一张邮票。
//     0.20.x 曾把下限钉死为 1（= 捏回原始大小）—— 那对「手机上的基数本来就是整宽装下」
//     成立，但桌面基数就是 1:1：宽图只能靠横向滚动，想「缩到一眼看全」做不到。
export const ZOOM_MAX = 4;
export const ZOOM_MIN = 0.2;
export function clampZoom(z, min){
  z = Number(z);
  if (!isFinite(z) || z <= 0) return min === undefined ? 1 : min;
  var lo = (min === undefined || !isFinite(min)) ? 1 : Math.min(1, Math.max(ZOOM_MIN, min));
  return z < lo ? lo : (z > ZOOM_MAX ? ZOOM_MAX : z);
}
