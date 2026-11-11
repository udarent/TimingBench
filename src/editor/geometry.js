// 编辑器布局常量：主画布与候选字符条共用的几何参数。
import { Core } from '../core/ir.js';

export const G = {
  CELL:38, NAME_W:132, ROW_H:48, TOP:64, PAD:16, ACT_W:196,
  CMD_Y:6, CMD_H:22, COL_Y:34, ACT_H:40,
  CHIP_W:28, CHIP_H:26, CHIP_STEP:30,
  XS:148,
  CHIPS_W:148 + Core.ALL.length*30 + 16
};
