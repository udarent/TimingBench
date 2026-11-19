// 站点自用的只读渲染：把页面上的 [data-wavejson] 占位画成波形图。
//
// 这不是「嵌入 / 导出」能力 —— 它只服务本站的首页展示与教程页示例，不生成片段、
// 不提供宿主接口、不装配编辑器 UI（顶栏 / 操作条都只是个空壳，且被 .is-readonly 收掉）。
// 渲染与编辑器共用同一套内核，所以页面上的图和编辑器里看到的一致。

import { Core } from './core/ir.js';
import { createEditor } from './editor/index.js';

const mk = (tag) => document.createElement(tag || 'div');

// 源码随 URL 片段传给编辑器（#wj=<base64url>）：不进服务端、可整段复制分享。
function encodeSource(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14.5 5.5l4 4"/></svg>';

function addEditLink(host, src) {
  const a = mk('a');
  a.className = 'tb-edit';
  a.href = 'editor.html#wj=' + encodeSource(src);
  a.title = 'Edit this diagram in the editor';
  a.setAttribute('aria-label', 'Edit this diagram in the editor');
  a.innerHTML = PENCIL;
  host.appendChild(a);
}

function render(host) {
  const src = host.getAttribute('data-wavejson');
  if (!src) return;

  try {
    Core.buildIR(src);
  } catch (e) {
    host.textContent = 'Diagram error: ' + (e && e.message ? e.message : String(e));
    return;
  }

  host.classList.add('tb-preview');

  const wrap = mk();
  wrap.className = 'svgwrap';
  host.textContent = '';
  host.appendChild(wrap);

  let ctx;
  try {
    ctx = createEditor({
      code: mk('textarea'),
      wrap: wrap,
      gutter: mk(),
      errdot: mk(),
      app: mk(),
      topbar: mk(),
      tbpanel: mk(),
      chardock: mk(),
      toast: mk(),
      root: host              // 只读 / 触摸的 class 落在预览根元素上，不污染 <html>
    });
    ctx.fromCode(src);
    ctx.setReadonly(true);
    ctx.setView('diagram');
  } catch (e) {
    host.textContent = 'Diagram error: ' + (e && e.message ? e.message : String(e));
    return;
  }

  // 编辑入口：跳编辑器并把这张图的源码带过去（预览本身保持只读）。
  addEditLink(host, src);

  // 宽度一变就要重算 fit（侧栏 / 窗口尺寸都可能变）
  let lastW = 0;
  let raf = 0;
  const ro = new ResizeObserver((entries) => {
    const w = entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0;
    if (!w || Math.abs(w - lastW) < 2) return;
    lastW = w;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      ctx.redraw();
    });
  });
  ro.observe(host);
}

const nodes = document.querySelectorAll('[data-wavejson]');
for (let i = 0; i < nodes.length; i++) render(nodes[i]);
