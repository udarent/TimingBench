// 编辑器装配层：状态 / 撤销历史 / 源码 ⇄ 图形双向同步 / 行号槽 / 初始化。
// 主页面唯一运行时。不含辅助页面、状态灯、模式切换等能力。
import { Core } from '../core/ir.js';
import { EXAMPLE } from '../core/example.js';
import { createShapes } from './shapes.js';
import { attachInteractions } from './interactions.js';
import { attachTouchUI } from './touch.js';

export function createEditor(dom){
  var ctx={
    code:dom.code, wrap:dom.wrap, gutter:dom.gutter, errdot:dom.errdot,
    EXAMPLE:EXAMPLE,
    state:{ ir:null, undo:[], redo:[], sel:null, selCell:null, selLane:null, ratio:1, parseOK:false,
            ch:'1', connect:null, W:0, H:0, drag:null, rev:0 },
    inlineCtx:null, painting:null
  };
  var state=ctx.state, code=ctx.code, gutter=ctx.gutter, errdot=ctx.errdot;
  var codeEditBase=null, lastCodeInput=0, timer=null;

  // 主页面不显示任何消息文字：只有源码解析失败时右上角一个红点，原因写在 title 里
  function notify(t,bad){
    if(bad){ errdot.hidden=false; errdot.title=String(t); }
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
      catch(e){ notify('代码尚未解析完成，图形编辑已推迟：'+e.message,true); return false; }
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
    catch(e){ notify('生成代码无法解析：'+e.message,true); return; }
    if(Core.canon(parsed)!==Core.canon(next)){ notify('I2 不变量失败：生成代码与 IR 语义不一致，已回滚',true); return; }
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
    catch(e){ state.parseOK=false; ctx.status(); notify('草稿态：'+e.message+(e.pos!==undefined?'（偏移 '+e.pos+'）':'')+'；保留上一次有效图形。',true); return; }
    state.ir=ir; state.parseOK=true; state.sel=null; state.ratio=1; state.connect=null; state.rev++;
    ctx.redraw(); ctx.status(); notify('代码 → IR → 图形');
  }

  function renderGutter(){
    var n=code.value.split('\n').length, s=[];
    for(var i=1;i<=n;i++) s.push(i);
    gutter.textContent=s.join('\n');
    gutter.scrollTop=code.scrollTop;
  }

  function doCmd(act){
    if(act!=='undo'&&act!=='redo') return;
    var stack=act==='undo'?state.undo:state.redo, back=act==='undo'?state.redo:state.undo;
    if(!stack.length) return;
    var p=stack.pop();
    back.push({ir:state.ir,src:code.value,sel:state.sel});
    state.ir=p.ir; state.sel=p.sel; code.value=p.src; state.parseOK=true; state.ratio=1;
    state.selCell=null; state.connect=null; state.rev++;
    ctx.redraw(); ctx.status(); notify(act==='undo'?'撤销':'重做');
  }

  function focusCanvas(){ try{ ctx.wrap.focus({preventScroll:true}); }catch(e){ try{ ctx.wrap.focus(); }catch(e2){} } }

  ctx.notify=notify; ctx.status=status; ctx.renderGutter=renderGutter;
  ctx.syncCode=syncCode; ctx.commit=commit; ctx.fromCode=fromCode;
  ctx.doCmd=doCmd; ctx.focusCanvas=focusCanvas; ctx.quotePos=quotePos;

  createShapes(ctx);
  attachInteractions(ctx);
  attachTouchUI(ctx, dom);
  // 触摸操作栏跟着每次重绘同步按钮可用态；桌面无 hook，重绘开销不变
  var paint=ctx.redraw;
  ctx.redraw=function(){ paint(); if(ctx.afterRedraw) ctx.afterRedraw(); };

  ctx.wrap.tabIndex=0;
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
