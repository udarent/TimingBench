// 主页面入口：仅装配编辑器，不加载任何辅助页面或能力。
import { createEditor } from './editor/index.js';

createEditor({
  code:   document.getElementById('code'),
  wrap:   document.getElementById('svgwrap'),
  gutter: document.getElementById('gutter'),
  errdot: document.getElementById('errdot')
});
