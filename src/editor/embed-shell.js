// 嵌入壳：只有 ?embed=1 时启用。
// 职责：默认只读（只画波形）、点一下进编辑、Esc 回只读、
// 与宿主页面 postMessage 双向同步（源码 / 只读态 / 高度）。
// 不碰渲染内核与编辑语义 —— 只控制「哪些层画、哪些事件放行」。
import { EMBED, EDIT_ON_START } from './embed.js';
import { G } from './geometry.js';
import { decodePayload } from './payload.js';

// 只有 iframe、没有脚本的宿主（Obsidian 笔记、只能贴 HTML 的编辑器）走 URL 片段带内容：
//   editor.html?embed=1#wj=<base64url(WaveJSON)>
// 片段不发给服务器，也不会被当查询串截断；用 URLSearchParams 取是为了将来能再加参数。
// 解不出来就当没有 —— 保留默认示例，不报错、不白屏。
function hashPayload() {
  try {
    var h = String(location.hash || '').replace(/^#/, '');
    if (!h) return '';
    var raw = new URLSearchParams(h).get('wj');
    return raw ? decodePayload(raw) : '';
  } catch (e) { return ''; }
}

export function attachEmbed(ctx, opts) {
  if (!EMBED || typeof window === 'undefined') return;
  var state = ctx.state;
  var docEl = document.documentElement;
  var hint = opts && opts.hint;
  var origin = '*';   // 宿主域名未知，默认放开；文档说明可用 event.origin 校验

  docEl.classList.add('is-embed');
  state.embedCard=true;        // 画布高度只按内容算，不留视口空白

  function post(type, payload) {
    try {
      if (window.parent && window.parent !== window)
        window.parent.postMessage(Object.assign({ source: 'timingbench', type: type }, payload || {}), origin);
    } catch (e) { /* cross-origin write blocked: local editing is unaffected */ }
  }

  function emitSrc() {
    var raw = ctx.code && ctx.code.value;
    if (typeof raw === 'string') post('change', { wavejson: raw });
  }

  // ---- 只读 ↔ 编辑 ---------------------------------------------------------
  // 提示条是一个图标按钮：铅笔 = 点一下可编辑，对勾 = 编辑中、点一下结束。
  // 视觉上零常驻文字，语义只走 aria-label（嵌入页是英文优先）。
  function setEditing(on, anchor) {
    var wasReadonly = state.readonly;
    ctx.setReadonly(!on);
    if (anchor && wasReadonly && on) anchorCell(anchor);
    if (hint) {
      hint.setAttribute('aria-label', on ? 'Finish editing and go back to read-only' : 'Edit this timing diagram');
      hint.setAttribute('aria-pressed', on ? 'true' : 'false');
      hint.classList.toggle('editing', !!on);
    }
    post('mode', { editing: !!on });
  }
  ctx.requestEdit = function (anchor) { setEditing(true, anchor); };

  // 从只读切到编辑，缩放会从「整图缩进卡片」跳成 1:1 —— 如果不管滚动位置，
  // 手指下面那块内容会整体挪走，第二次点按就落到别的格子上（手机端最难受的地方）。
  // 这里把被点的格子「钉」在原来的屏幕位置上：知道它的内部坐标、知道手指在视口里的位置，
  // 反解出该有的 scrollLeft / scrollTop。视图可能被等比缩过（触摸端 / 只读卡放大），
  // 所以内部坐标要乘 state.fit 才是像素。
  // 纵向到底是谁在滚，不能想当然：独立编辑器里是 .svgwrap（inset:0 + overflow:auto），
  // 嵌入卡片里 .svgwrap 的高度被内容撑开、自己滚不动，真正滚的是 body（body{overflow:auto}）
  // —— 这时改 wrap.scrollTop 和 window.scrollBy 都没反应。往上找第一个真能滚的祖先。
  function verticalScroller(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var oy = '';
      try { oy = window.getComputedStyle(n).overflowY; } catch (e) { oy = ''; }
      if (/(auto|scroll)/.test(oy) && n.scrollHeight > n.clientHeight + 2) return n;
    }
    var doc = document.scrollingElement || document.documentElement;
    if (doc && doc.scrollHeight > doc.clientHeight + 2) return doc;
    return null;
  }

  function anchorCell(anchor) {
    if (!anchor || !anchor.cell) return;
    var st = ctx.state, ir = st.ir, wrap = ctx.wrap;
    if (!ir || !wrap) return;
    var li = -1;
    ir.lanes.forEach(function (l, i) { if (l.id === anchor.cell.lane) li = i; });
    if (li < 0) return;
    var k = st.fit || 1;
    var cx = (G.XS + anchor.cell.tick * G.CELL + G.CELL / 2) * k;
    var cy = (G.TOP + li * G.ROW_H + G.ROW_H / 2) * k;
    var r = wrap.getBoundingClientRect();
    var vx = (anchor.x || 0) - r.left, vy = (anchor.y || 0) - r.top;
    var maxL = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
    wrap.scrollLeft = Math.min(maxL, Math.max(0, cx - vx));
    // 纵向：位移量在两种滚动容器下是同一个数（内容坐标差），只是要施加到会动的那个上
    var dy = cy - vy;
    var vs = verticalScroller(wrap);
    if (vs) vs.scrollTop = Math.min(vs.scrollHeight - vs.clientHeight, Math.max(0, vs.scrollTop + dy));
  }

  // 点提示条可来回切换：只读时进编辑，编辑态时回只读
  if (hint) {
    hint.addEventListener('click', function (e) {
      e.stopPropagation();
      if (state.readonly) setEditing(true);
      else { setEditing(false); }
    });
  }

  // Esc 退出编辑（就地输入 / 连线模式优先自己处理，已在 interactions 里拦截）
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // 内层（就地编辑框 / 清选中）已经消费过这次 Esc 就不再接管 —— 层级见 interactions.js
    if (e.defaultPrevented) return;
    if (state.readonly) return;
    if (ctx.inlineCtx || state.linkMode) return;   // 让内层先消费
    if (ctx.closePanel) ctx.closePanel();
    setEditing(false);
  });

  // 编辑后把源码推给宿主（宿主可据此保存）
  var baseCommit = ctx.commit;
  ctx.commit = function (op, label, silent) {
    var r = baseCommit(op, label, silent);
    emitSrc();
    return r;
  };
  var baseFromCode = ctx.fromCode;
  ctx.fromCode = function (src) {
    var r = baseFromCode(src);
    emitSrc();
    return r;
  };
  var baseDoCmd = ctx.doCmd;
  ctx.doCmd = function (act) {
    var r = baseDoCmd(act);
    emitSrc();
    return r;
  };

  // ---- 高度自适应：把波形真实高度告诉宿主，宿主据此设 iframe 高度 --------
  var lastH = 0;
  function reportHeight() {
    // 顶栏是页面级 flex 子项（撤销 / 重做 / 嵌入），不在 SVG 的 contentH 里，上报时要加上。
    var topEl = document.getElementById('topbar');
    var topH = topEl && topEl.offsetHeight ? topEl.offsetHeight : 0;
    var h = Math.ceil((state.contentH || state.H || 0) + topH + 2);
    if (h > 0 && Math.abs(h - lastH) >= 1) { lastH = h; post('height', { height: h }); }
  }
  var baseRedraw = ctx.redraw;
  ctx.redraw = function () { baseRedraw(); reportHeight(); };

  // ---- 接收宿主指令 -------------------------------------------------------
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'host' || typeof d.type !== 'string') return;
    if (d.type === 'setSource' && typeof d.wavejson === 'string') {
      if (ctx.code) ctx.code.value = d.wavejson;
      ctx.fromCode(d.wavejson);
      reportHeight();
      return;
    }
    if (d.type === 'setMode') { setEditing(d.editing === true || d.mode === 'edit'); return; }
  });

  // 初始态：默认只读（?mode=edit 可直接进编辑）
  // 内容来源优先级：宿主显式 setSource（走 data-wavejson / mount）> URL 片段 > 默认示例。
  // 片段先落地，宿主的 setSource 到了自然会覆盖它。
  var seeded = hashPayload();
  if (seeded) {
    if (ctx.code) ctx.code.value = seeded;
    ctx.fromCode(seeded);
  }
  setEditing(EDIT_ON_START);
  post('ready', { wavejson: ctx.code ? ctx.code.value : '', editing: EDIT_ON_START });
  setTimeout(reportHeight, 0);
}
