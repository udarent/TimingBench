// 编辑器布局常量：主画布与候选字符条共用的几何参数。
// fine 指针沿用参考版式；coarse 指针整组放大到可点按尺寸（≥44 CSS px 的命中区）。
// 模式在模块求值时确定，import 本文件后再读取 G.* 的模块拿到的是同一份结果。
import { Core } from '../core/ir.js';
import { TOUCH } from './mode.js';

export const G = {
  CELL:      TOUCH ? 48 : 38,
  // 行名区宽度与波形起点在运行时**按内容自适应**（shapes.js 每次 redraw 重算并写回
  // G.NAME_W / G.XS），这里的值只是首帧兜底。算法：
  //   NAME_W = clamp(64, 上限, leftBound + 最宽行名 + 16)，leftBound = PAD +（桌面编辑态 ? 18 : 0）
  //   XS     = NAME_W + 8
  // 只读态与触摸端不画拖拽把手，左界就只剩 PAD —— 名字短时行名区自然更窄。
  NAME_W:    TOUCH ? 96 : 104,
  ROW_H:     TOUCH ? 60 : 48,
  TOP:       TOUCH ? 88 : 64,
  PAD:       16,
  ACT_W:     TOUCH ? 24 : 196,   // 触摸端行工具改由操作栏承担，画布右侧不再留 196px
  CMD_Y:     TOUCH ? 8 : 6,
  CMD_H:     TOUCH ? 40 : 22,
  COL_Y:     TOUCH ? 54 : 34,
  ACT_H:     40,
  CHIP_W:    TOUCH ? 44 : 28,
  CHIP_H:    TOUCH ? 44 : 26,
  CHIP_STEP: TOUCH ? 48 : 30,
  // 波形起点：首帧兜底值 = 上面的 NAME_W + 8，同样在 redraw 里按内容重算。
  XS:        TOUCH ? 104 : 112
};

// 桌面单行字符条的最小画布宽度；触摸端字符条换行，不再用它撑宽画布。
G.CHIPS_W = G.XS + Core.ALL.length * G.CHIP_STEP + 16;
