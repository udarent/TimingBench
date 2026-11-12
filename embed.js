/*!
 * TimingBench 嵌入加载器 —— 宿主页面一行引入：
 *
 *   <script src="https://udarent.github.io/TimingBench/embed.js"></script>
 *   <div data-timingbench data-wavejson='{ signal: [ { name:"clk", wave:"p..." } ] }'
 *        data-mode="view" data-height="240"></div>
 *
 * 也可不写 data-wavejson，改用 JS 传：
 *   TimingBenchEmbed.mount(el, { wavejson, mode:'edit' })
 *
 * 行为：为每个 [data-timingbench] 生成一个 iframe（src=?embed=1），
 * 默认只读、点一下进编辑；编辑结果通过 'timingbench:change' 事件回传。
 */
(function () {
  'use strict';

  var SCRIPT = document.currentScript;
  var BASE = (function () {
    try {
      var u = new URL(SCRIPT && SCRIPT.src ? SCRIPT.src : '../TimingBench/embed.js', location.href);
      return u.href.replace(/embed\.js(\?.*)?$/, '');
    } catch (e) { return './'; }
  })();

  function showError(el, msg) {
    el.textContent = 'TimingBench failed to load: ' + msg;
    el.style.cssText += ';padding:10px;border:1px solid #f0b4b4;border-radius:8px;color:#a32d2d;font:12px system-ui,sans-serif';
  }

  function mount(el, opts) {
    if (!el) return null;
    if (el.__tbApi) return el.__tbApi;              // 幂等：重复 mount 直接复用同一个 api
    opts = opts || {};
    var wavejson = opts.wavejson || el.getAttribute('data-wavejson') || '';
    var mode = opts.mode || el.getAttribute('data-mode') || 'view';
    var height = opts.height || el.getAttribute('data-height') || 240;

    var frame = document.createElement('iframe');
    frame.src = BASE + 'editor.html?embed=1' + (mode === 'edit' ? '&mode=edit' : '');
    frame.title = opts.title || el.getAttribute('data-title') || 'TimingBench diagram';
    frame.loading = 'lazy';
    frame.style.cssText = 'display:block;width:100%;border:0;height:' + (parseInt(height, 10) || 240) + 'px';
    frame.setAttribute('allowtransparency', 'true');

    el.__tbFrame = frame;
    el.innerHTML = '';
    el.appendChild(frame);

    var api = {
      el: el,
      frame: frame,
      setSource: function (src) { post('setSource', { wavejson: String(src) }); },
      setMode: function (m) { post('setMode', { editing: m === 'edit' }); },
      setHeight: function (h) { frame.style.height = (parseInt(h, 10) || 240) + 'px'; },
      post: post
    };

    function post(type, payload) {
      var d = { source: 'host', type: type };
      for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) d[k] = payload[k];
      if (frame.contentWindow) frame.contentWindow.postMessage(d, '*');
    }

    var ready = false, pending = [];
    function flush() { while (pending.length) post.apply(null, pending.shift()); }

    window.addEventListener('message', function (e) {
      if (e.source !== frame.contentWindow) return;
      var d = e.data;
      if (!d || d.source !== 'timingbench') return;

      if (d.type === 'ready') {
        ready = true;
        if (wavejson) post('setSource', { wavejson: wavejson });
        if (mode === 'edit') post('setMode', { editing: true });
        if (d.height) api.setHeight(d.height);
        flush();
        el.dispatchEvent(new CustomEvent('timingbench:ready', { bubbles: true, detail: api }));
        return;
      }
      if (d.type === 'height') { api.setHeight(d.height + 2); return; }
      if (d.type === 'mode') {
        el.dispatchEvent(new CustomEvent('timingbench:mode', { bubbles: true, detail: { editing: !!d.editing, api: api } }));
        return;
      }
      if (d.type === 'change') {
        // 回传给宿主：可直接存起来，或同步回自己的数据源
        el.dispatchEvent(new CustomEvent('timingbench:change', {
          bubbles: true, detail: { wavejson: d.wavejson, api: api }
        }));
      }
    });

    el.__tbApi = api;
    return api;
  }

  function scan(root) {
    var list = (root || document).querySelectorAll('[data-timingbench]');
    for (var i = 0; i < list.length; i++) {
      try { mount(list[i]); } catch (err) { showError(list[i], err.message); }
    }
  }

  function boot() {
    scan(document);
    if (window.MutationObserver) {
      new MutationObserver(function (ms) {
        for (var i = 0; i < ms.length; i++) {
          var added = ms[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.hasAttribute && n.hasAttribute('data-timingbench')) { try { mount(n); } catch (e) { showError(n, e.message); } }
            if (n.querySelectorAll) scan(n);
          }
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.TimingBenchEmbed = { mount: mount, scan: scan, base: BASE };
})();
