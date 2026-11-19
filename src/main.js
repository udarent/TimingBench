// 主页面入口：仅装配编辑器，不加载任何辅助页面或能力。
import { createEditor } from './editor/index.js';
import { TOUCH } from './editor/mode.js';
import { Core } from './core/ir.js';

if (TOUCH) document.documentElement.classList.add('is-touch');

const codeEl = document.getElementById('code');

const ctx = createEditor({
  code:     codeEl,
  wrap:     document.getElementById('svgwrap'),
  gutter:   document.getElementById('gutter'),
  errdot:   document.getElementById('errdot'),
  app:      document.getElementById('app'),
  topbar:   document.getElementById('topbar'),
  tbpanel:  document.getElementById('tbpanel'),
  chardock: document.getElementById('chardock'),
  toast:    document.getElementById('toast')
});

// 首页 / 教程页的铅笔把该图源码放在片段里传进来（#wj=<base64url>）。
// 片段坏了就留在默认示例，不影响编辑器可用。
const m = /^#wj=([A-Za-z0-9_-]+)$/.exec(location.hash);
if (m) {
  try {
    // base64url 去掉了补位，atob 要求长度是 4 的倍数，先补回来
    const pad = (4 - (m[1].length % 4)) % 4;
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice(0, pad));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // 页面上的源码是压缩单行，排成多行再进代码框（用户自己写过的多行源码原样保留）
    const src = Core.formatSource(new TextDecoder().decode(bytes));
    codeEl.value = src;      // fromCode 只解析重绘，源码框要自己写
    ctx.fromCode(src);
    ctx.renderGutter();
  } catch (e) { /* 保留默认示例 */ }
}
