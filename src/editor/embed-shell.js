// 嵌入壳：只有 ?embed=1 时启用。
// 职责：默认只读（只画波形）、点一下进编辑、Esc 回只读、
// 与宿主页面 postMessage 双向同步（源码 / 只读态 / 高度）。
// 不碰渲染内核与编辑语义 —— 只控制「哪些层画、哪些事件放行」。
import { EMBED, EDIT_ON_START } from './embed.js';
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
  function setEditing(on) {
    ctx.setReadonly(!on);
    if (hint) {
      hint.setAttribute('aria-label', on ? 'Finish editing and go back to read-only' : 'Edit this timing diagram');
      hint.setAttribute('aria-pressed', on ? 'true' : 'false');
      hint.classList.toggle('editing', !!on);
    }
    post('mode', { editing: !!on });
  }
  ctx.requestEdit = function () { setEditing(true); };

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
    var h = Math.ceil((state.contentH || state.H || 0) + 2);
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
