// 主页面入口：仅装配编辑器，不加载任何辅助页面或能力。
import { createEditor } from './editor/index.js';
import { TOUCH } from './editor/mode.js';
import { EMBED } from './editor/embed.js';
import { attachEmbed } from './editor/embed-shell.js';

if (TOUCH) document.documentElement.classList.add('is-touch');

const ctx = createEditor({
  code:     document.getElementById('code'),
  wrap:     document.getElementById('svgwrap'),
  gutter:   document.getElementById('gutter'),
  errdot:   document.getElementById('errdot'),
  app:      document.getElementById('app'),
  tbpanel:  document.getElementById('tbpanel'),
  chardock: document.getElementById('chardock'),
  charmore: document.getElementById('charmore'),
  toast:    document.getElementById('toast')
});

// 嵌入模式（?embed=1）：只显示波形卡片，并接管只读 / 编辑切换与宿主通信
if (EMBED) attachEmbed(ctx, { hint: document.getElementById('embedhint') });
