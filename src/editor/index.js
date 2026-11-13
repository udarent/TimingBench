// 编辑器装配层：状态 / 撤销历史 / 源码 ⇄ 图形双向同步 / 行号槽 / 初始化。
// 主页面唯一运行时。不含辅助页面、状态灯、模式切换等能力。
import { Core } from '../core/ir.js';
import { EXAMPLE } from '../core/example.js';
import { createShapes } from './shapes.js';
import { attachInteractions } from './interactions.js';
import { attachTouchUI } from './touch.js';
import { attachShare } from './share.js';

export function createEditor(dom){
  var ctx={
    code:dom.code, wrap:dom.wrap, gutter:dom.gutter, errdot:dom.errdot,
    EXAMPLE:EXAMPLE,
    state:{ ir:null, undo:[], redo:[], sel:null, selCell:null, selLane:null, ratio:1, parseOK:false,
            ch:'1', connect:null, linkMode:false, linkCursor:null, edgeIdx:0,
            W:0, H:0, drag:null, rev:0, readonly:false },
    inlineCtx:null, painting:null
  };
  var state=ctx.state, code=ctx.code, gutter=ctx.gutter, errdot=ctx.errdot;
  var codeEditBase=null, lastCodeInput=0, timer=null;

  // 主页面不显示任何消息文字：阻止类提示先给图形反馈，文字只做兜底。
  // 图形 —— 在被拦住的目标上瞬时画一圈红环。红环是 SVG 里的临时图元，只做不透明度 / 线宽动画，
  // 既不位移也不改布局，因此不会打乱钉在可视区的 HUD 与字符条，也不进波形层指纹。
  // 文字 —— 桌面落进右上红点的 title，触摸端落进一次性轻提示（英文）。
  function denyRing(el){
    var svg=ctx.svgRoot&&ctx.svgRoot();
    if(!svg||!el||!el.getBoundingClientRect||!svg.getScreenCTM) return;
    var r=el.getBoundingClientRect();
    if(r.width<1&&r.height<1) return;
    var inv=svg.getScreenCTM(); if(!inv) return;
    inv=inv.inverse();
    var a=svg.createSVGPoint(), b=svg.createSVGPoint();
    a.x=r.left; a.y=r.top; b.x=r.right; b.y=r.bottom;
    a=a.matrixTransform(inv); b=b.matrixTransform(inv);
    var ring=document.createElementNS('http://www.w3.org/2000/svg','rect');
    ring.setAttribute('class','denyRing');
    ring.setAttribute('x',Math.round(a.x)-3); ring.setAttribute('y',Math.round(a.y)-3);
    ring.setAttribute('width',Math.max(8,Math.round(b.x-a.x)+6));
    ring.setAttribute('height',Math.max(8,Math.round(b.y-a.y)+6));
    ring.setAttribute('rx','4');
    svg.appendChild(ring);
    setTimeout(function(){ if(ring.parentNode) ring.parentNode.removeChild(ring); },480);
  }
  function notify(t,bad,el){
    if(bad){
      errdot.hidden=false; errdot.title=String(t);
      errdot.classList.remove('pulse'); void errdot.offsetWidth; errdot.classList.add('pulse');
      if(el) denyRing(el);
    }
    else { errdot.hidden=true; errdot.title=''; }
  }
  function status(){ if(state.parseOK){ errdot.hidden=true; errdot.title=''; } }

  function quotePos(l,tick){
    if(!l.waveRange) return null;
    var base=l.waveRange[0]+1, s=l.orig.wave, n=0, i=0;
    for(i=0;i<s.length&&n<tick;i++){ if(s[i]!=='<'&&s[i]!=='>') n++; }
    return base+i;
  }

  // 源码是唯一事实源：图形提交前先把编辑器最新文本解析成 IR，避免输入竞态
  function syncCode(){
    if(code.value!==state.ir.raw){
      try{ state.ir=Core.buildIR(code.value); state.parseOK=true; }
      catch(e){ notify('Source not parsed yet, diagram edit deferred: '+e.message,true); return false; }
    }
    return true;
  }

  // 图形 → 码：一次提交可含多个 EditOp（两点连线把 node 分配与 edge 写入合并为一次撤销）
  function commit(op,label,skipUndo,noCaret){
    if(!syncCode()) return;
    var before={ ir:state.ir, src:code.value, sel:state.sel };
    var ops=Array.isArray(op)?op:[op], first=ops[0];
    var selLaneAfter=state.selLane;
    if(first.t==='addLane') selLaneAfter='@'+first.at;
    else if(first.t==='moveLane'){
      var oi=-1; state.ir.lanes.forEach(function(x,i){ if(x.id===first.lane) oi=i; });
      selLaneAfter='@'+Math.max(0,Math.min(state.ir.lanes.length-1,oi+(first.v==='up'?-1:1)));
    } else if(first.t==='deleteLane') selLaneAfter=null;
    var next=state.ir;
    for(var oi2=0;oi2<ops.length;oi2++) next=Core.applyOp(next,ops[oi2]);
    // patchSource 优先最小补丁；结构 / edge 变化无法字面表达时自动回退全量 emitIR
    var res=Core.patchSource(state.ir,next);
    var parsed;
    try{ parsed=Core.buildIR(res.src); }
    catch(e){ notify('Generated source does not parse: '+e.message,true); return; }
    if(Core.canon(parsed)!==Core.canon(next)){ notify('I2 invariant failed: generated source diverges from IR, rolled back',true); return; }
    if(!skipUndo){ state.undo.push(before); if(state.undo.length>60) state.undo.shift(); state.redo.length=0; }
    state.ir=parsed; state.ratio=res.ratio; code.value=res.src; state.parseOK=true;
    if(typeof selLaneAfter==='string'&&selLaneAfter.charAt(0)==='@'){
      var ski=+selLaneAfter.slice(1);
      state.selLane=parsed.lanes[ski]?parsed.lanes[ski].id:null;
    } else state.selLane=selLaneAfter;
    // saved 只用于相位线切换可逆，不写入源码；重新解析后需从 next 转移回来
    if(next.lanes.length===parsed.lanes.length){
      next.lanes.forEach(function(nl,i){
        var pl=parsed.lanes[i];
        if(!pl||!nl.slots||!pl.slots||nl.slots.length!==pl.slots.length) return;
        nl.slots.forEach(function(s,j){ if(s.saved) pl.slots[j].saved={w:s.saved.w,label:s.saved.label}; });
      });
    }
    state.rev++;
    ctx.redraw(); ctx.status(); notify(label);
    var l=null; state.ir.lanes.forEach(function(x){ if(x.id===(first.lane||(first.lanes&&first.lanes[0]))) l=x; });
    // 图形提交后把源码选区锚到对应位置（焦点仍留在画布，选中格能接着接键盘字符）
    if(!noCaret&&l&&first.tick!==undefined){ var pos=quotePos(l,first.tick); if(pos!==null){ try{ code.setSelectionRange(pos,pos+1); }catch(e){} } }
  }

  // 码 → 图：解析失败保留上一次有效图形
  function fromCode(src){
    var ir;
    try{ ir=Core.buildIR(src); }
    catch(e){ state.parseOK=false; ctx.status(); notify('Draft: '+e.message+(e.pos!==undefined?' (offset '+e.pos+')':'')+'; keeping the last valid diagram',true); return; }
    state.ir=ir; state.parseOK=true; state.sel=null; state.ratio=1; state.connect=null; state.rev++;
    ctx.redraw(); ctx.status();
  }

  function renderGutter(){
    var n=code.value.split('\n').length, s=[];
    for(var i=1;i<=n;i++) s.push(i);
    gutter.textContent=s.join('\n');
    gutter.scrollTop=code.scrollTop;
  }

  // ---- 键盘可达：焦点 / 初始选中 / 选中夹取 ---------------------------------
  // 页面常驻文字为零，键盘用户靠 Tab / F6 进入画布；一旦画布获得焦点且尚无选中格，
  // 自动落在第一条信号行的 t0，之后所有编辑都能纯键盘完成。
  // ---- 分屏方向：左右 / 上下，由 HUD 的按钮切换并记住 ---------------------
  // 没有显式选择时跟随宽度（CSS 媒体查询决定），一旦点过按钮就写死并持久化 ——
  // 用户的选择比「窗口多宽」更能代表意图。
  function currentLayout(){
    if (state.layout) return state.layout;
    // 用与 CSS 媒体查询同一个阈值（860px）判断，**不要**读 getComputedStyle：
    // 之前用 split(/\s+/) 解析 gridTemplateColumns，正则里的反斜杠在转义过程中丢失，
    // 变成 split(/s+/) —— 永远不分割、永远算出 'rows'，于是 auto 状态下点一下按钮
    // 会「设成和当前一样的方向」，表现为点了没反应。
    return (typeof window !== 'undefined' && window.innerWidth >= 860) ? 'cols' : 'rows';
  }
  function applyLayout(){
    if(!dom.app) return;
    if(state.layout) dom.app.setAttribute('data-layout',state.layout);
    else dom.app.removeAttribute('data-layout');
  }
  function toggleLayout(){
    state.layout = currentLayout()==='cols'?'rows':'cols';
    try{ localStorage.setItem('tb-layout',state.layout); }catch(e){ /* 隐私模式等忽略 */ }
    applyLayout(); ctx.redraw();
  }
  ctx.currentLayout=currentLayout; ctx.toggleLayout=toggleLayout;

  function signalLanes(){
    var out=[];
    if(state.ir) state.ir.lanes.forEach(function(l){ if(l.kind==='signal') out.push(l); });
    return out;
  }
  function firstCell(){ var ls=signalLanes(); return ls.length?{lane:ls[0].id,tick:0}:null; }
  function ensureSelCell(){
    if(!state.ir||state.linkMode) return state.selCell;
    if(!state.selCell){ state.selCell=firstCell(); if(state.selCell){ state.selLane=state.selCell.lane; ctx.redraw(); } }
    return state.selCell;
  }
  // 结构编辑会改变行数 / 周期数，命令结束后把选中格夹回有效范围（不改 IR）
  function clampSel(){
    var sc=state.selCell; if(!sc||!state.ir) return sc;
    var N=Math.max(1,state.ir.ticks), found=false;
    state.ir.lanes.forEach(function(l){ if(l.id===sc.lane&&l.kind==='signal') found=true; });
    if(!found){ var f=firstCell(); sc={lane:f?f.lane:sc.lane,tick:Math.min(sc.tick,N-1)}; }
    else sc={lane:sc.lane,tick:Math.max(0,Math.min(sc.tick,N-1))};
    state.selCell=sc; state.selLane=sc.lane;
    return sc;
  }
  function focusPane(which){
    if(which==='src'){ try{ code.focus({preventScroll:true}); }catch(e){ code.focus(); } return; }
    focusCanvas(); ensureSelCell();
  }

  // 图形区的两种操作互斥：linkMode 关闭时波形格只做时序编辑，开启时只做连线端点。
  // 切换只走这一个入口，保证按钮状态、选中态、连线光标与绘制层一次同步。
  function setLinkMode(on){
    on=!!on;
    var from=state.selCell, lc=null;
    if(on&&state.ir){
      var valid=false, N=state.ir.ticks;
      state.ir.lanes.forEach(function(l){ if(from&&l.id===from.lane&&l.kind==='signal') valid=true; });
      lc=valid?{lane:from.lane,tick:Math.max(0,Math.min(from.tick,N-1))}:firstCell();
    }
    state.linkMode=on; state.connect=null; state.linkCursor=lc;
    state.selCell=null; state.sel=null; state.selLane=null;
    ctx.painting=null;
    if(ctx.inlineCtx) ctx.closeInline(true);
    ctx.redraw(); ctx.status();
  }

  function doCmd(act){
    if(act==='link'){ setLinkMode(!state.linkMode); return; }
    if(act==='embed'){ if(ctx.openEmbedCode) ctx.openEmbedCode(); return; }
    if(act==='layout'){ toggleLayout(); return; }
    if(act!=='undo'&&act!=='redo') return;
    var stack=act==='undo'?state.undo:state.redo, back=act==='undo'?state.redo:state.undo;
    if(!stack.length) return;
    var p=stack.pop();
    back.push({ir:state.ir,src:code.value,sel:state.sel});
    state.ir=p.ir; state.sel=p.sel; code.value=p.src; state.parseOK=true; state.ratio=1;
    state.selCell=null; state.connect=null; state.rev++;
    ctx.redraw(); ctx.status();
  }

  function focusCanvas(){ try{ ctx.wrap.focus({preventScroll:true}); }catch(e){ try{ ctx.wrap.focus(); }catch(e2){} } }

  // 只读态：波形照常渲染、可滚动缩放，但不出 HUD / 字符条，点击不产生任何编辑。
  // 嵌入卡片默认只读（以看为主），点一下波形进入编辑；Esc 或点空白回到只读。
  var readonlyListeners=[];
  function setReadonly(on){
    on=!!on;
    if(state.readonly===on) return;
    state.readonly=on;
    if(on){
      state.selCell=null; state.sel=null; state.selLane=null;
      state.linkMode=false; state.connect=null; state.linkCursor=null;
      if(ctx.inlineCtx) ctx.closeInline(true);
      if(ctx.closePanel) ctx.closePanel();
      if(ctx.hideToast) ctx.hideToast();
      if(ctx.wrap.blur) try{ ctx.wrap.blur(); }catch(e){}
    }
    document.documentElement.classList.toggle('is-readonly', on);
    ctx.redraw(); ctx.status();
    for(var i=0;i<readonlyListeners.length;i++) readonlyListeners[i](on);
  }
  ctx.setReadonly=setReadonly;
  ctx.isReadonly=function(){ return state.readonly; };
  ctx.onReadonlyChange=function(fn){ readonlyListeners.push(fn); };

  ctx.notify=notify; ctx.status=status; ctx.renderGutter=renderGutter;
  ctx.denyRing=denyRing;
  ctx.syncCode=syncCode; ctx.commit=commit; ctx.fromCode=fromCode;
  ctx.doCmd=doCmd; ctx.setLinkMode=setLinkMode; ctx.focusCanvas=focusCanvas; ctx.quotePos=quotePos;
  ctx.focusPane=focusPane; ctx.ensureSelCell=ensureSelCell; ctx.clampSel=clampSel;

  try{ var saved=localStorage.getItem('tb-layout'); if(saved==='rows'||saved==='cols') state.layout=saved; }catch(e){}
  applyLayout();
  createShapes(ctx);
  attachInteractions(ctx);
  attachTouchUI(ctx, dom);
  attachShare(ctx);
  // 触摸操作栏跟着每次重绘同步按钮可用态；桌面无 hook，重绘开销不变
  var paint=ctx.redraw;
  ctx.redraw=function(){ paint(); if(ctx.afterRedraw) ctx.afterRedraw(); };

  ctx.wrap.tabIndex=0;
  // 焦点进画布时补一个可操作格子（纯键盘用户 Tab 进来就能直接打字）。
  // 但只有在「什么都没选」时才补：触摸端点完列头 / 行名，浏览器还会补发一次原生 focus，
  // 若无条件补选，会把刚弹出来的列 / 行上下文条用「第一个格子」顶掉（表现为面板一闪就没）。
  ctx.wrap.addEventListener('focus',function(){
    if(state.linkMode||state.readonly) return;
    var hasSel=state.selCell||state.selLane||(state.sel!==null&&state.sel!==undefined);
    if(hasSel) return;
    ensureSelCell();
  });
  // 卡片口径：波形层可横向滚动 / 双指缩放，操作层（HUD、字符条）钉在可视区。
  // 滚动只改这两个 <g> 的位移，不重绘；旋屏 / 窗口缩放才需要重排（字符条按可视宽度换行）。
  var rzTimer=null;
  window.addEventListener('resize',function(){
    clearTimeout(rzTimer);
    rzTimer=setTimeout(function(){ if(!ctx.inlineCtx) ctx.redraw(); },120);
  });
  ctx.wrap.addEventListener('scroll',function(){ if(ctx.syncPinned) ctx.syncPinned(); });
  code.addEventListener('scroll',function(){ gutter.scrollTop=code.scrollTop; });
  code.addEventListener('input',function(){
    renderGutter();
    var now=Date.now();
    if(!codeEditBase||now-lastCodeInput>1500) codeEditBase={ ir:state.ir, src:state.ir?state.ir.raw:EXAMPLE, sel:state.sel };
    lastCodeInput=now;
    clearTimeout(timer);
    timer=setTimeout(function(){
      if(codeEditBase){ state.undo.push(codeEditBase); state.redo.length=0; codeEditBase=null; }
      fromCode(code.value);
    },320);
  });

  code.value=EXAMPLE;
  fromCode(EXAMPLE);
  return ctx;
}
