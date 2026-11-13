// 嵌入代码分享：把当前 WaveJSON 生成宿主可粘贴的 HTML 片段，并提供复制面板。
// 只读当前编辑器状态、只写一个浮层 DOM，不参与渲染与编辑语义。
//
// 两种形态，对应两类宿主：
//   script + div —— 有脚本的页面；高度自动跟随、可监听 timingbench:change
//   纯 iframe     —— 只能贴 HTML 的地方（Obsidian 笔记等）；内容随 URL 片段一起走，无脚本
import { encodePayload } from './payload.js';

export function attachShare(ctx) {
  if (typeof document === 'undefined') return;
  var panel = null, codeEl = null, tipEl = null, hintEl = null;
  var snippets = {}, kind = 'script';
  // 面板打开的时刻。触摸 tap 会在 pointerup 之后补发一次合成 mousedown，
  // 落点正是刚插入的遮罩本身 —— 不设这道时间窗，遮罩会立刻按「点空白关闭」把自己关掉，
  // 手机上表现为「点了生成嵌入代码按钮没反应」（面板确实建了，只是 16ms 后就没了）。
  var openedAt = 0;
  var OPEN_GUARD = 400;

  // 站点基址：从当前页面地址推导，自托管 / 本地 / Pages 都能得到正确前缀
  function baseUrl() {
    try {
      var u = new URL(location.href);
      return u.origin + u.pathname.replace(/[^/]*$/, '');
    } catch (e) { return ''; }
  }

  // 属性值用双引号包裹：WaveJSON 里基本都是单引号，这样片段可读性最好；
  // 只需转义 & < > 与双引号（&#34; 比 &quot; 在部分高亮器里更稳定）。
  function attrText(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&#34;');
  }

  // 数量级参考：嵌入卡片默认只读，高度等于「波形内容 + 底部留白」，不含字符条
  function contentHeight() {
    return Math.ceil((ctx.state.barY || 240) + 20);
  }

  // 形态一：脚本 + 占位 div。高度自动、可回传 change，适合普通网页
  function scriptSnippet(src, h) {
    var open = '<' + 'script src="' + baseUrl() + 'embed.js">';
    var close = '<' + '/script>';
    return open + close + '\n' +
      '<div data-timingbench data-height="' + h + '"\n' +
      '     data-wavejson="' + attrText(src) + '"></div>';
  }

  // 形态二：纯 iframe。没有脚本可用时（Obsidian 笔记、只允许 HTML 的编辑器），
  // 内容改用 base64url 放在 URL 片段里 —— 片段不发给服务器，也不会被查询串截断。
  // 高度不能写死：只读卡片按容器宽度等比缩放，同一个 height 在窄笔记里会空出上百像素
  // （作者在 Obsidian 手机端看到的「波形图与编辑按钮之间一大片空白」就是这么来的）。
  // 改用 aspect-ratio = 内部 W/H：高度随容器宽度走，图正好铺满，不留空白。
  // height 属性留作不支持 aspect-ratio 的老浏览器兜底。
  function iframeSnippet(src, box) {
    var url = baseUrl() + 'editor.html?embed=1#wj=' + encodePayload(src);
    var w = (box && box.w) || 560, h = (box && box.h) || 376;
    return '<iframe src="' + attrText(url) + '"\n' +
      '        style="width:100%;height:auto;aspect-ratio:' + w + ' / ' + h +
                ';border:0;border-radius:10px;display:block"\n' +
      '        height="' + h + '" loading="lazy" title="Timing diagram"></iframe>';
  }

  var HINTS = {
    script: 'Paste these two lines into your page. The diagram renders read-only; a click makes it ' +
            'editable, and the card reports its own height so it never needs a fixed one.',
    iframe: 'No script needed. Paste this as a raw HTML block — in Obsidian, straight into the note ' +
            '(not inside a code fence). The content travels in the URL, so it renders anywhere ' +
            'that allows an iframe. Height follows the container width (aspect-ratio), so there is ' +
            'no blank strip under the diagram; editing happens inside the card and scrolls.'
  };

  function build() {
    panel = document.createElement('div');
    panel.className = 'shareMask';
    panel.innerHTML =
      '<div class="sharePanel" role="dialog" aria-modal="true" aria-label="Embed code">' +
        '<div class="shareHead"><span>Embed in your page</span>' +
          '<button type="button" class="shareClose" aria-label="Close">✕</button></div>' +
        '<div class="shareTabs" role="tablist" aria-label="Embed form">' +
          '<button type="button" class="shareTab" role="tab" data-kind="script" aria-selected="true">Script tag</button>' +
          '<button type="button" class="shareTab" role="tab" data-kind="iframe" aria-selected="false">iframe only</button>' +
        '</div>' +
        '<p class="shareHint"></p>' +
        '<textarea class="shareCode" readonly spellcheck="false" aria-label="Embed snippet"></textarea>' +
        '<div class="shareFoot"><button type="button" class="shareCopy">Copy</button>' +
          '<span class="shareTip" aria-live="polite"></span></div>' +
      '</div>';
    document.body.appendChild(panel);
    codeEl = panel.querySelector('.shareCode');
    tipEl = panel.querySelector('.shareTip');
    hintEl = panel.querySelector('.shareHint');

    panel.querySelector('.shareClose').addEventListener('click', close);
    // 点遮罩空白关闭。用 pointerdown 覆盖鼠标与触摸两条路径，并挡掉「打开瞬间的那一次」：
    // 触摸端补发的合成 mousedown 不可靠（老设备上 pointerdown 反而更早更稳）。
    panel.addEventListener('pointerdown', function (e) {
      if (Date.now() - openedAt < OPEN_GUARD) return;
      if (e.target === panel) close();
    });
    // 老浏览器没有 Pointer Events 时退回 mousedown，同样带时间窗
    panel.addEventListener('mousedown', function (e) {
      if (Date.now() - openedAt < OPEN_GUARD) return;
      if (e.target === panel) close();
    });
    panel.querySelector('.shareCopy').addEventListener('click', copy);
    panel.querySelector('.shareTabs').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button[data-kind]') : null;
      if (b) showKind(b.getAttribute('data-kind'));
    });
    codeEl.addEventListener('focus', function () { codeEl.select(); });
    // Esc 关闭：捕获阶段处理，避免被画布的内层 Esc 逻辑先吃掉
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }, true);
  }

  function showKind(k) {
    if (!snippets[k]) return;
    kind = k;
    var bs = panel.querySelectorAll('.shareTab');
    for (var i = 0; i < bs.length; i++)
      bs[i].setAttribute('aria-selected', String(bs[i].getAttribute('data-kind') === k));
    hintEl.textContent = HINTS[k] || '';
    codeEl.value = snippets[k];
    codeEl.scrollTop = 0;
  }

  function copy() {
    var text = codeEl.value;
    function done(ok) {
      tipEl.textContent = ok ? 'Copied' : 'Select and copy manually';
      tipEl.className = 'shareTip' + (ok ? ' ok' : '');
      setTimeout(function () { if (tipEl) tipEl.textContent = ''; }, 1800);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback(text)); });
        return;
      }
    } catch (e) { /* fall through to the manual hint */ }
    done(fallback(text));
  }

  function fallback(text) {
    try {
      codeEl.removeAttribute('readonly');
      codeEl.select();
      var ok = document.execCommand && document.execCommand('copy');
      codeEl.setAttribute('readonly', '');
      return !!ok;
    } catch (e) { return false; }
  }

  function close() {
    if (!panel) return;
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    panel = null; codeEl = null; tipEl = null;
    openedAt = 0;
    ctx.focusCanvas();
  }

  ctx.openEmbedCode = function () {
    if (panel) { codeEl && codeEl.select(); return; }
    build();
    // 时间窗从「刚插入」算起：触摸 tap 的合成 mousedown 会在其后几十毫秒内到达
    openedAt = Date.now();
    var src = (ctx.code && ctx.code.value) || '';
    var box = (ctx.state && ctx.state.roBox) || { w: 560, h: 376 };
    snippets = { script: scriptSnippet(src, contentHeight()), iframe: iframeSnippet(src, box) };
    showKind('script');
    try { codeEl.focus({ preventScroll: true }); } catch (e) { try { codeEl.focus(); } catch (e2) {} }
  };
  ctx.closeEmbedCode = close;
}
