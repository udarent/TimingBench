// 编辑器布局常量：主画布与候选字符条共用的几何参数。
// fine 指针沿用参考版式；coarse 指针整组放大到可点按尺寸（≥44 CSS px 的命中区）。
// 模式在模块求值时确定，import 本文件后再读取 G.* 的模块拿到的是同一份结果。
import { Core } from '../core/ir.js';
import { TOUCH } from './mode.js';

export const G = {
  CELL:      TOUCH ? 48 : 38,
  NAME_W:    TOUCH ? 152 : 132,
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
  XS:        TOUCH ? 168 : 148
};

// 桌面单行字符条的最小画布宽度；触摸端字符条换行，不再用它撑宽画布。
G.CHIPS_W = G.XS + Core.ALL.length * G.CHIP_STEP + 16;
