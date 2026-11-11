// 主页面入口：仅装配编辑器，不加载任何辅助页面或能力。
import { createEditor } from './editor/index.js';
import { TOUCH } from './editor/mode.js';

if (TOUCH) document.documentElement.classList.add('is-touch');

createEditor({
  code:     document.getElementById('code'),
  wrap:     document.getElementById('svgwrap'),
  gutter:   document.getElementById('gutter'),
  errdot:   document.getElementById('errdot'),
  app:      document.getElementById('app'),
  tabbar:   document.getElementById('tabbar'),
  touchbar: document.getElementById('touchbar'),
  tbpanel:  document.getElementById('tbpanel'),
  toast:    document.getElementById('toast')
});
