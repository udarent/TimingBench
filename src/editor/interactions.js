// 图形侧交互：命中解析、foreignObject 就地编辑、整行/整列工具、两点式 edge 连线、
// 完整键盘操作层与拖拽。连线与时序编辑共用 rect.cell 命中区，由 state.linkMode 互斥分派；
// 键盘另有独立的 linkCursor 端点光标，保证不用鼠标也能完成全部编辑。
// 只产生 EditOp 交给 ctx.commit()，不直接改源码、不画辅助 UI。
import { Core } from '../core/ir.js';
import { G, cellGeo, PHASE_STEP, PHASE_MAX } from './geometry.js';
import { TOUCH } from './mode.js';

// 格宽受 config.hscale 影响，是每帧重算的运行时值 —— 这里一律现读 G.CELL，不缓存。
var ROW_H=G.ROW_H, TOP=G.TOP;
// 行名区宽度按内容自适应 → 波形起点 XS 是运行时值，必须每次现读 G.XS，
// 不能像以前那样在模块加载时缓存一份（名字变长变短后它会过期）。

export function attachInteractions(ctx){
  var state=ctx.state, code=ctx.code, wrap=ctx.wrap;
  function findLane(id){
    var l=null;
    if(state.ir&&id) state.ir.lanes.forEach(function(x){ if(x.id===id) l=x; });
    return l;
  }

  // 阻止类提示的图形目标：优先给「被拦住的那个图元」，让红环落在用户刚点的地方
  function laneRowEl(id){ return wrap.querySelector('rect.laneRow[data-lane="'+id+'"]'); }

  // 就地编辑器：foreignObject 直接挂在目标 SVG 里，横向滚动时跟着图元一起走
  function svgRoot(){ return wrap.querySelector('svg'); }
  function closeInline(doCommit,restoreFocus){
    if(!ctx.inlineCtx) return;
    var ed=ctx.inlineCtx, v=ed.input.value;
    ctx.inlineCtx=null;
    if(ed.fo&&ed.fo.parentNode) ed.fo.parentNode.removeChild(ed.fo);
    // 一个字都没改就不提交：失焦（点画布 / 切到源码框 / Tab）本来也算「结算」，
    // 但「打开又关掉」不该产生任何编辑 —— 否则组路径这类「预填值重新解析 ≠ 原值」的输入
    // 会凭空改文档（一级组里的行预填 `a`，单段按「加一层」解释，重交一次就成了 `a/a`），
    // 顺带也不再往撤销栈里塞空步骤。
    if(doCommit && v!==ed.initial){ try{ ed.apply(v); }catch(e){ ctx.notify('Inline edit failed: '+e.message,true); } }
    // 键盘结算（Enter / Esc）后把焦点还给画布，否则必须再点一次画布才能继续纯键盘编辑。
    // 失焦提交不抢焦点：用户可能正点进源码框。
    if(restoreFocus) ctx.focusCanvas();
  }
  function openInline(el,value,apply,opts){
    opts=opts||{};
    closeInline(false);
    var svg=svgRoot(); if(!el||!svg) return;
    var bb;
    try{ bb=el.getBBox(); }catch(e){ return; }
    // 触摸端整张画布是等比缩小的（state.fit），按 1:1 定的框会被一起压小 ——
    // 输入框按「≈36 物理像素高」反算用户单位（有上下限），手指点的仍是同一个输入框。
    var fit=state.fit||1;
    var w=Math.max(34,Math.min(opts.width||bb.width,320));
    var h=TOUCH?Math.min(44,Math.max(24,Math.round(36/fit))):22;
    var x=Math.max(0,Math.min(bb.x,state.W-w-2)), y=Math.max(0,Math.min(bb.y-2,state.H-h-2));
    var fo=document.createElementNS('http://www.w3.org/2000/svg','foreignObject');
    fo.setAttribute('class','inline-fo');
    fo.setAttribute('x',x); fo.setAttribute('y',y); fo.setAttribute('width',w); fo.setAttribute('height',h);
    var inp=document.createElementNS('http://www.w3.org/1999/xhtml','input');
    inp.setAttribute('class','inline-edit');
    inp.setAttribute('spellcheck','false'); inp.setAttribute('autocomplete','off');
    inp.value=(value===undefined||value===null)?'':String(value);
    inp.title=opts.title||'Enter to confirm · Esc to cancel';
    inp.placeholder=opts.placeholder||'';
    fo.appendChild(inp);
    svg.appendChild(fo);
    ctx.inlineCtx={apply:apply,input:inp,fo:fo,initial:inp.value};
    inp.addEventListener('keydown',function(e){
      if(e.key==='Enter'){ e.preventDefault(); closeInline(true,true); }
      else if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeInline(false,true); }
    });
    // 触摸端有个坑：长按 480ms 打开就地编辑后抬手，浏览器会把焦点交给被摸的画布，
    // 一次 blur 就把刚出现的输入框关掉 —— 用户根本来不及打字。这里区分「焦点被画布抢走」
    // 与「用户真的切走」（点源码框 / 切标签页 / 点其它控件），只对前者把焦点抢回来。
    var openedAt=Date.now();
    inp.addEventListener('blur',function(){
      var ae=document.activeElement;
      if(TOUCH&&Date.now()-openedAt<1200&&
         (ae===document.body||ae===wrap||(ae&&wrap.contains(ae)))){
        try{ inp.focus(); }catch(e){}
        return;
      }
      closeInline(true);
    });
    // 一律全选：输入框里的值是「当前路径」，用户要么打一个新的，要么用 `/…` 从头写，
    // 光把光标放末尾会让「想改个名」变成「把名字接在旧路径后面」（实测 a/b 上敲 c 得到 a/bc）。
    try{ inp.focus(); inp.select(); }catch(e){}
  }
  function cellAt(e){
    var g=e.target;
    while(g&&g!==wrap){
      if(g.getAttribute){
        var ln=g.getAttribute('data-lane');
        if(g.classList&&g.classList.contains('emptyRow')) return {empty:1};
        if(g.classList&&g.classList.contains('edgeArc')) return {edgeIdx:+g.getAttribute('data-eidx')};
        // 只有带 data-act 的徽标才是可点入口（触摸端不接线，见 shapes.js）：否则落到外层行名上，
        // 一次「想选中这一行」的轻点不会顺手打开相位尺。
        if(g.classList&&g.classList.contains('laneMeta')&&g.getAttribute('data-act')) return {meta:g.getAttribute('data-act'),lane:ln};
        // 触摸端相位模式里行尾那个 φ 读数（桌面不画）：轻点它 = 改这一行的精确相位值。
        // 走的是同一个 meta 分支，所以「敲数字」与「拖波形」共用一条 setPhase 通路。
        if(g.classList&&g.classList.contains('phaseValueHit')) return {meta:'phase',lane:ln};
        // 组名 / 括号命中区只认「这一层的路径」—— 行 id 在这里没用（行的 groupPath 是它自己的最深层）
        if(g.classList&&(g.classList.contains('laneGroupName')||g.classList.contains('groupHit')))
          return {group:g.getAttribute('data-group')};
        if(g.classList&&g.classList.contains('colhead')) return {col:+g.getAttribute('data-c')};
        if(g.classList&&g.classList.contains('laneName')) return {nameLane:ln};
        if(g.classList&&g.classList.contains('cell')) return {lane:ln,tick:+g.getAttribute('data-tick')};
        if(g.classList&&g.classList.contains('laneRow')) return {rowLane:ln};
      }
      g=g.parentNode;
    }
    return null;
  }

  // 每个行内工具 / 图元徽标对应的就地编辑规格
  function rowSpec(l,act){
    switch(act){
      case 'phase': return { val:String(l.phase), title:'phase — shifts the lane left by that many periods (fractional is fine)', label:'phase', meta:true, width:96,
        makeOp:function(v){ var n=Number(v); return v!==''&&isFinite(n)?{t:'setPhase',lane:l.id,v:n}:null; } };
      case 'period': return { val:String(l.period), title:'period (>=1)', label:'period', meta:true, width:96,
        makeOp:function(v){ var n=Number(v); return v!==''&&isFinite(n)&&n>=1?{t:'setPeriod',lane:l.id,v:n}:null; } };
      case 'wave': return { val:Core.laneWave(l), title:'row wave', label:'row wave', wide:true,
        makeOp:function(v){ return {t:'setWave',lane:l.id,v:v}; } };
      case 'data': return { val:Core.laneLabels(l).join(' '), title:'row data (space separated, empty removes)', label:'row data', wide:true,
        makeOp:function(v){ return {t:'setLabels',lane:l.id,v:v}; } };
      case 'node': return { val:l.node.join('').replace(/\.+$/,''), title:'row node', label:'row node', wide:true,
        makeOp:function(v){ return {t:'setNodeStr',lane:l.id,v:v}; } };
    }
    return null;
  }
  function openRowEditor(laneId,act){
    var l=findLane(laneId); if(!l) return;
    if(l.kind==='spacer'){ ctx.notify('Spacer rows have no editable field',true,laneRowEl(laneId)); return; }
    if(act==='wave'&&!rawWaveGuard(l)) return;
    var spec=rowSpec(l,act); if(!spec) return;
    // 锚点只有两种规格：wide（整行波形区）与 meta（行名旁的 φ / T）。三级回落是为了
    // 触摸端 —— 那里的徽标「只画不接线」（没有 data-act），只能按 data-lane 找；
    // 而读数命中区会随 closePhaseEdit 的 redraw 消失，所以它排最后、只当兜底。
    var anchor=spec.wide
      ? wrap.querySelector('rect.waveZone[data-lane="'+laneId+'"]')
      : (wrap.querySelector('tspan.laneMeta[data-act="'+act+'"][data-lane="'+laneId+'"]')
         || wrap.querySelector('tspan.laneMeta[data-lane="'+laneId+'"]')
         || wrap.querySelector('rect.phaseValueHit[data-lane="'+laneId+'"]'));
    if(!anchor) return;
    openInline(anchor,spec.val,function(v){
      var op=spec.makeOp(v);
      if(!op){ ctx.notify('Invalid input: '+(act==='phase'?'phase must be a number':'period must be a number >= 1'),true,anchor); return; }
      ctx.commit(op,spec.label+' → '+v);
    },{ title:spec.title+' · Enter to confirm / Esc to cancel', placeholder:spec.title, width:spec.width });
  }
  // ---- 相位尺：图形化改 phase -----------------------------------------------
  // 为什么不做成「输入框旁边再加两个按钮」：相位是**连续量**，用户真正要的是「拖着看波形
  // 怎么挪过去」，而不是「先想一个数、再敲进去」。所以点 φ 徽标把**整条波形区**变成一把尺子：
  //   按下即定位（滑块语义）、按住拖动连续改、每一帧都真重绘（不是假预览）。
  // 撤销的粒度按「手势」算：一次拖动 / 一串方向键 = 一步。做法与漫刷同一套 —— 拖动期间
  // 用 skipUndo 提交（源码即时同步、IR 即时生效），手势结束时把「这一串开始前的快照」压栈。
  // **0.14.5：波形本身就是抓手。** 不再有尺子 / 滑块 —— 打开相位模式后，在这一行的波形上
  // 横向拖，波形跟着手走。所以换算也从「指针 x → 绝对相位」变成「手指位移 → 相位增量」：
  // 每次 move 都从**手势起点**重算（`gest0 - dx/CELL`），不做增量叠加，免得多帧累积误差；
  // 方向是「手指往右 ⇒ 波形往右 ⇒ 相位变小」（phase 是左移量）。
  // 为什么不用「按下即定位」：那是控件的语义。抓着波形按下去就先跳一下值，用户只想按住
  // 看一眼也会误改 —— 所以按下不改值，超过 PHASE_DEAD 才动。
  var PHASE_DEAD=4;                       // 手指位移小于 4px 不动值（按住看一眼不该跳值）
  function openPhaseEdit(laneId){
    var l=findLane(laneId); if(!l||l.kind!=='signal'||!state.ir) return;
    if(state.phaseEdit&&state.phaseEdit.lane===laneId){ closePhaseEdit(true); return; }  // 再点一次收起
    if(state.phaseEdit) closePhaseEdit(true);
    // pushed：本次会话推了几步撤销；redo0：打开时的重做栈快照（取消时要还原）
    state.phaseEdit={lane:laneId, orig:l.phase, pending:null, pushed:0, redo0:state.redo.slice()};
    // 尺子开着时画布不许原生平移（理由见 styles.css 的 `.svgwrap.is-phase`）：不加这一条，
    // 触摸拖动会被浏览器的滚动仲裁判成平移，一次 pointercancel 就把手势截断。
    if(wrap.classList) wrap.classList.add('is-phase');
    state.selLane=laneId; state.selCell=null; state.sel=null;
    if(ctx.clearSpan) ctx.clearSpan();
    ctx.redraw();
  }
  // 一次手势 = 一步撤销：把「这一串改动开始前的快照」压栈，并清掉 pending
  function flushPhaseStep(){
    var pe=state.phaseEdit; if(!pe||!pe.pending) return;
    state.undo.push(pe.pending); if(state.undo.length>60) state.undo.shift();
    state.redo.length=0; pe.pending=null; pe.pushed+=1;
  }
  // 只改 IR + 重绘：不进撤销栈（收尾时压一步），但源码与波形都是即时生效的
  function applyPhase(v){
    var pe=state.phaseEdit; if(!pe) return;
    var l=findLane(pe.lane); if(!l||l.phase===v) return;
    if(!pe.pending) pe.pending={ir:state.ir, src:ctx.code.value, sel:state.sel};   // 快照必须在 commit 之前取
    ctx.commit({t:'setPhase',lane:pe.lane,v:v},'phase → '+v,true,true);
  }
  function closePhaseEdit(keep){
    var pe=state.phaseEdit; if(!pe) return;
    state.phaseEdit=null;
    if(wrap.classList) wrap.classList.remove('is-phase');
    var l=findLane(pe.lane);
    if(l&&l.phase!==pe.orig){
      if(keep) flushPhaseStep();
      else{
        // 取消：值还原成打开时的样子，并把这次会话推入的撤销步一起摘掉（不留「空的一步」），
        // 顺手还原重做栈 —— 用户感觉就像这段编辑没发生过。
        ctx.commit({t:'setPhase',lane:pe.lane,v:pe.orig},'phase',true,true);
        if(pe.pushed) state.undo.splice(Math.max(0,state.undo.length-pe.pushed), pe.pushed);
        state.redo=pe.redo0;
      }
    } else if(!keep&&pe.pushed){
      // 值已经被拖回原值：撤销步同样要摘掉
      state.undo.splice(Math.max(0,state.undo.length-pe.pushed), pe.pushed);
      state.redo=pe.redo0;
    }
    ctx.redraw();
  }
  // 抓住波形：先**待命**（armed）—— 不动就不改值、也不算拖动；超过死区才真的开始。
  // 这样「按一下」仍然是选中格子（见 endPhaseTap），「按住横拖」才是改相位。
  function startPhaseDrag(e){
    var pe=state.phaseEdit, l0=pe&&findLane(pe.lane);
    if(!pe||!l0) return false;
    // 触摸 / 笔有「隐式指针捕获」：后续 pointermove 会认准按下时那个元素。而这一行每帧重绘
    // 都会把元素换掉 —— 捕获目标一旦脱离文档，move / up 就既不投递也不冒泡（Android 实测）。
    // 改成捕获在 wrap 上：它不参与重绘，整段手势的坐标都还能收到。
    try{ if(e.pointerId!==undefined&&wrap.setPointerCapture) wrap.setPointerCapture(e.pointerId); }catch(err){}
    // gest0 = 这次手势开始前的值：既用来重算「手指位移 → 相位」，也用于手势被改判成
    // 「移动视图」时原地撤回（否则两指一落下就把相位改了 —— 那正是要消灭的误操作）。
    pe.gest0=l0.phase;
    pe.dragX=e.clientX||0;
    pe.armed=true;
    pe.downC=cellAt(e);
    return true;
  }
  // 抬手时若一次都没拖动：按普通 tap 处理（选中这一格，并顺手退出相位模式）
  function endPhaseTap(isTouch){
    var pe=state.phaseEdit;
    if(!pe||!pe.armed) return false;
    var c=pe.downC; pe.armed=false;
    closePhaseEdit(true);
    if(c) dispatchTarget(c, {clientX:0,clientY:0,detail:0,preventDefault:function(){}}, isTouch);
    return true;
  }
  function movePhaseDrag(e){
    var pe=state.phaseEdit; if(!pe) return false;
    if(!ctx.phaseDrag&&!pe.armed) return false;
    var dx=(e.clientX||0)-pe.dragX;
    if(!ctx.phaseDrag){
      if(Math.abs(dx)<PHASE_DEAD) return true;            // 死区：按住看一眼不该跳值
      ctx.phaseDrag=true; pe.armed=false;                 // 过了死区才算「开始拖」
    }
    var v=pe.gest0-dx/G.CELL;
    v=Math.round(v/PHASE_STEP)*PHASE_STEP;                // 吸附 0.05（与键盘、文本输入同一口径）
    applyPhase(+Math.max(0,Math.min(PHASE_MAX,v)).toFixed(2));
    return true;
  }

  // piece-wise 路径（`wave: ['pw', {d: …}]`）不是字符序列，改字符等于把路径换成字符串。
  // 能改，但要先说清楚 —— 悄悄丢掉用户写的路径是最坏的一种「帮倒忙」。
  function rawWaveGuard(l,el){
    if(!l||!l.waveRaw) return true;
    ctx.notify('This row is a piece-wise path (wave: [\'pw\', …]) — editing a cell replaces it with characters',true,el||laneRowEl(l.id));
    return false;
  }
  function handleTool(act,laneId){
    if(act==='del'){ state.selLane=null; ctx.commit({t:'deleteLane',lane:laneId},'delete row'); return; }
    if(act==='add'||act==='spacer'){
      var at=0; state.ir.lanes.forEach(function(x,i){ if(x.id===laneId) at=i+1; });
      var id='ln'+Date.now().toString(36);
      ctx.commit({t:'addLane',id:id,name:'new',at:at,kind:act==='spacer'?'spacer':'signal'},act==='spacer'?'add spacer':'add signal row');
    }
  }
  function handleColAct(act,c){
    if(act==='insert') ctx.commit({t:'insertTick',tick:c},'insert cycle @ t'+c);
    else if(act==='delete') ctx.commit({t:'deleteTick',tick:c},'delete cycle @ t'+c);
    else if(act==='gap') ctx.commit({t:'toggleGap',tick:c},'toggle phase line @ t'+c);
  }
  function openEdgeEditor(i){
    var cur=state.ir&&state.ir.edges[i]; if(cur===undefined) return;
    // 端点节点字符缺失的 edge 没有可见弧线；键盘编辑时退到选中格作为输入框锚点，
    // 保证任何一条 edge 都能改 / 清空删除，不必依赖鼠标能否命中曲线。
    var sc=state.selCell;
    var anchor=wrap.querySelector('g.edgeArc[data-eidx="'+i+'"]') ||
      (sc?cellTarget(sc.lane,sc.tick):null) || wrap.querySelector('rect.waveZone');
    if(!anchor) return;
    openInline(anchor,cur,function(v){
      var t=v.trim(), arr=state.ir.edges.slice();
      if(!t) arr.splice(i,1); else arr[i]=t;
      ctx.commit({t:'setEdges',v:arr},'edit edge -> '+(t||'remove'));
    },{ title:'edge · Enter to confirm / Esc to cancel / empty removes', placeholder:'a~>b t1', width:170 });
  }

  // 状态写入的唯一操作：给「选中格」一个字符，写入后自动右移
  function writeChar(v,dir){
    var sc=state.selCell;
    if(!sc||!state.ir){ ctx.notify('Select a cell first (Tab / F6 focuses the canvas)',true); return; }
    if(!rawWaveGuard(findLane(sc.lane))) return;
    var N=state.ir.ticks;
    state.ch=v;
    var nt=dir==='left'?Math.max(0,sc.tick-1):Math.min(sc.tick+1,N-1);
    state.selCell={lane:sc.lane,tick:nt};
    ctx.commit({t:'setSlot',lanes:[sc.lane],tick:sc.tick,v:v},'write '+v+' @ t'+sc.tick,false,true);
    // 触摸端：每次写入后把新选中格带进可视区（底部停靠条占掉的那一条不算可视区）
    if(TOUCH&&ctx.revealSel) ctx.revealSel();
  }

  // 把选中格挪进可视区：横向居中、纵向避开底部停靠条。
  // 只在「已经在编辑态、选中又变了」时调用 —— 从只读切进编辑那一下由嵌入壳做锚定，
  // 两者都动滚动就会互相打架，手指底下的东西会跳。
  function revealSel(){
    var sc=state.selCell; if(!sc||!state.ir||!wrap.clientWidth) return;
    var lane=null, li=-1; state.ir.lanes.forEach(function(l,i){ if(l.id===sc.lane){ lane=l; li=i; } });
    if(li<0||!lane) return;
    // 视图可能是等比缩小过的（触摸端 / 卡片），状态里一律是**用户坐标**，
    // 而 scrollLeft / clientWidth 是像素 —— 先乘 fit 再比较，否则滚到错地方。
    var k=state.fit||1;
    // 格心与格宽都走行级标尺（period 行更宽、phase 行整体左移）；period:1 时与 CELL 等价。
    var geo=cellGeo(lane,sc.tick), cw=geo.w*k;
    var cx=geo.cx*k, cy=(TOP+li*ROW_H+ROW_H/2)*k;
    var vw=wrap.clientWidth, vh=wrap.clientHeight;
    var maxL=Math.max(0,wrap.scrollWidth-vw), maxT=Math.max(0,wrap.scrollHeight-wrap.clientHeight);
    var left=wrap.scrollLeft, top=wrap.scrollTop;
    if(cx<left+cw*0.6||cx>left+vw-cw*0.6) left=Math.min(maxL,Math.max(0,cx-vw/2));
    if(cy<top+ROW_H*k*0.6||cy>top+vh-ROW_H*k*0.6) top=Math.min(maxT,Math.max(0,cy-vh/2));
    if(left!==wrap.scrollLeft) wrap.scrollLeft=left;
    if(top!==wrap.scrollTop) wrap.scrollTop=top;
  }

  // 触摸端选中一行后，上下文条会从底部升起；把这一行滚到「条上方」的可视区里，
  // 否则矮卡片（嵌入 340px）里被选中的行正好藏在面板后面，点 up / down 时看不见效果。
  // 面板是 .pane.diagram 的真实 flex 子项，wrap.clientHeight 已经把它的高度让出来了 ——
  // 这里不能再减一次面板高度（旧版面板是绝对浮层才需要补），否则会多滚一截、底部空一片。
  function revealLane(laneId){
    if(!state.ir||!wrap.clientWidth) return;
    var li=-1; state.ir.lanes.forEach(function(l,i){ if(l.id===laneId) li=i; });
    if(li<0) return;
    var k=state.fit||1;                        // 用户坐标 → 像素，见 revealSel 的说明
    var cy=(TOP+li*ROW_H+ROW_H/2)*k;
    var vh=wrap.clientHeight;
    if(vh<ROW_H*k*2) vh=ROW_H*k*2;             // 卡片太矮时至少保证两行之内的判断可用
    var maxT=Math.max(0,wrap.scrollHeight-wrap.clientHeight);
    var top=wrap.scrollTop;
    if(cy<top+ROW_H*k*0.6||cy>top+vh-ROW_H*k*0.6) top=Math.min(maxT,Math.max(0,cy-vh/2));
    if(top!==wrap.scrollTop) wrap.scrollTop=top;
  }

  // 两点式连线：仅在 linkMode 下由 rect.cell 分派进来，端点与时序编辑是同一片格子。
  // 点第一个格子 → 预览曲线跟随鼠标 → 点第二个格子，node + edge 合并一次提交；
  // 成线（或失败）后自动退出连线模式，回到普通时序编辑。
  function nodeChar(laneId,tick){
    var l=findLane(laneId);
    return l&&l.node&&l.node[tick]&&l.node[tick]!=='.'?l.node[tick]:'';
  }
  function handleAnchor(a){
    var li=-1; state.ir.lanes.forEach(function(l,i){ if(l.id===a.lane) li=i; });
    if(li<0||state.ir.lanes[li].kind!=='signal') return;
    if(!state.connect){
      state.connect={lane:a.lane,tick:a.tick,node:a.node,li:li};
      ctx.redraw(); ctx.focusCanvas();
      return;
    }
    var s=state.connect;
    if(s.lane===a.lane&&s.tick===a.tick){ state.connect=null; ctx.redraw(); ctx.notify('Start point cleared, pick a cell again'); return; }
    if(!ctx.syncCode()){ state.connect=null; state.linkMode=false; state.linkCursor=null; ctx.redraw(); return; }
    var used={}, ops=[];
    state.ir.lanes.forEach(function(l){ (l.node||[]).forEach(function(ch){ if(ch&&ch!=='.') used[ch]=1; }); });
    function ensure(o){
      if(o.node) return o.node;
      for(var i=0;i<26;i++){
        var ch=String.fromCharCode(97+i);
        if(!used[ch]){ used[ch]=1; ops.push({t:'setNode',lane:o.lane,tick:o.tick,v:ch}); return ch; }
      }
      return null;
    }
    var na=ensure(s), nb=ensure(a);
    if(!na||!nb||na===nb){
      var badAt={lane:s.lane,tick:s.tick};
      state.connect=null; state.linkMode=false; state.linkCursor=null; ctx.redraw();
      ctx.notify('Link failed: not enough node letters, or both ends are the same',true,cellTarget(badAt.lane,badAt.tick));
      return;
    }
    var arr=state.ir.edges.slice(), newHead=na+'~>'+nb, found=-1, oldHead='';
    arr.forEach(function(t,i){
      var h=String(t).trim().split(/\s+/)[0]||'';
      if(h.charAt(0)===na&&h.charAt(h.length-1)===nb){ found=i; oldHead=h; }
    });
    if(found>=0){
      var rest=String(arr[found]).slice(oldHead.length).trim();
      arr[found]=newHead+(rest?' '+rest:'');
    } else arr.push(newHead);
    ops.push({t:'setEdges',v:arr});
    state.connect=null; state.linkMode=false; state.linkCursor=null;
    ctx.commit(ops,'link '+na+' -> '+nb,false,true);
  }

  // 统一的格子双击：无论该格当前是 1 / 4 / x 还是尾部续写格，恒为编辑「这一格的波形字符」
  // 节点标记与数据标签不再按波形内容分派，各自回到自己的图元上（锚点 / ✎ 徽标）
  function cellTarget(laneId,tick){
    return wrap.querySelector('rect.cell[data-lane="'+laneId+'"][data-tick="'+tick+'"]');
  }
  function openCellCharEditor(laneId,tick){
    var l=findLane(laneId); if(!l||l.kind==='spacer') return;
    var target=cellTarget(laneId,tick); if(!target) return;
    if(!rawWaveGuard(l,target)) return;
    var sl=l.slots[tick], cur=sl?sl.w:(l.slots.length?l.slots[l.slots.length-1].w:'x');
    openInline(target,cur,function(v){
      var t=String(v).trim();
      if(Core.ALL.indexOf(t)<0){ ctx.notify('Allowed wave characters: '+Core.ALL.join(''),true,target); return; }
      ctx.commit({t:'setSlot',lanes:[laneId],tick:tick,v:t},'edit wave char -> '+t);
    },{ title:'wave character · Enter to confirm / Esc to cancel', placeholder:'1 / 0 / x / 4 / P ...', width:126 });
  }
  function openNodeEditor(laneId,tick,curNode){
    var l=findLane(laneId); if(!l||l.kind==='spacer'||tick>=l.slots.length) return;
    var target=cellTarget(laneId,tick); if(!target) return;
    var n=l.node[tick], cur=(curNode&&curNode!=='.')?curNode:(n&&n!=='.'?n:'');
    openInline(target,cur,function(v){
      var t=String(v).trim().charAt(0)||'.';
      ctx.commit({t:'setNode',lane:laneId,tick:tick,v:t},'edit node marker -> '+(t==='.'?'clear':t));
    },{ title:'node marker (single char) · Enter to confirm / Esc to cancel', placeholder:'a', width:110 });
  }
  function openLabelEditor(laneId,tick){
    var l=findLane(laneId); if(!l||l.kind==='spacer') return;
    var sl=l.slots[tick];
    if(!sl||!sl.point||sl.gap||!Core.BUS.test(sl.w)){ ctx.notify('This cell is not a data block',true,cellTarget(laneId,tick)); return; }
    var target=cellTarget(laneId,tick); if(!target) return;
    openInline(target,sl.label||'',function(v){
      var t=String(v).trim();
      ctx.commit({t:'setLabel',lane:laneId,tick:tick,v:t},'edit data label -> '+(t||'empty'));
    },{ title:'data label · Enter to confirm / Esc to cancel / empty removes', placeholder:'label', width:140 });
  }
  function openInlineFor(s){
    if(s.edgeIdx!==undefined){ openEdgeEditor(s.edgeIdx); return; }
    if(s.group!==undefined){ openGroupEditor(s.group); return; }
    if(s.nameLane){
      var l=findLane(s.nameLane); if(!l||l.kind==='spacer') return;
      var el=wrap.querySelector('text.laneName[data-lane="'+s.nameLane+'"] tspan.laneNameText');
      openInline(el,l.name,function(v){ ctx.commit({t:'rename',lane:s.nameLane,v:v},'rename -> '+v); },
        { title:'signal name · Enter to confirm / Esc to cancel', placeholder:'name', width:140 });
      return;
    }
    if(s.lane===undefined||s.tick===undefined) return;
    openCellCharEditor(s.lane,s.tick);
  }
  // 分组编辑的唯一入口，两种定址、同一个 EditOp：
  //   · 点左侧括号旁的竖排组名 —— 作用在**这棵子树**上（`regroup` 的 `old` 是前缀匹配，
  //     所以改外层时整棵子树跟着走、改子层不动兄弟与外层）。
  //   · 行上下文条的「组」动作 —— 作用在**选中的这些行**上（`regroup` 的 `lanes`）。
  // 两者语义完全一样：**把这些行的 groupPath 设成输入框里的路径**。
  //
  // 输入框里就是**完整路径**，`/` 只是分隔符，一级一段：
  //   `bus` = 一级组；`a/b` = 二级；空 = 不属于任何组（顶层）。
  // 加一层 / 减一层就是直接改这段文本（末尾写 `/c`、删掉一段）—— 路径本身就是全局描述，
  // 不需要额外按钮，也不对文本做任何推断（单段到底是建一级组还是退到一级组，猜哪边都错一半）。
  function openGroupEditor(groupPath){
    var el, prefill, target;
    if(groupPath!==undefined && groupPath!==null){
      // 传进来的是**这一层括号的完整路径**（外层 `out`、内层 `out/in` 各是各的）——
      // 不能拿行 id 反查：行的 groupPath 是它自己的最深层，点外层括号会改错层。
      var names=wrap.querySelectorAll('.laneGroupName');
      for(var gi=0;gi<names.length;gi++){ if(names[gi].getAttribute('data-group')===groupPath){ el=names[gi]; break; } }
      if(!el) return;
      prefill=groupPath;
      target={old:prefill};
    } else {
      var span=ctx.spanLanes?ctx.spanLanes():[];
      if(!span.length||!state.ir) return;
      // 输入框贴在被选范围的首行行名上（没有行名时贴画布左上）
      el=wrap.querySelector('text.laneName[data-lane="'+span[0].id+'"]')||wrap.querySelector('svg');
      // 预填：整段共同路径（都在同一组里就是该组名，混选则留空）
      prefill=commonPath(span.map(function(l){ return l.groupPath; })).join('/');
      target={lanes:span.map(function(l){ return l.id; })};
    }
    openInline(el,prefill,function(v){
      var path=groupPathOf(v);
      if(!groupPathChanged(path,target)) return;      // 解析结果与现状相同 ⇒ 什么都没发生，不提交
      var op=target.old!==undefined?{t:'regroup',old:target.old,path:path}:{t:'regroup',lanes:target.lanes,path:path};
      var label=(target.old!==undefined?'regroup ['+target.old+']':'group '+target.lanes.length+' row(s)')+
        ' -> '+(path.join('/')||'(none)');
      ctx.commit(op,label);
    },{ title:'group path — one segment per level (a/b), empty = no group; type or edit the path directly',
        placeholder:'group', width:180 });
  }
  // 解析出来的路径是否真的改变了目标 —— 用来挡掉「提交了但什么都没变」的空编辑
  // （空编辑会整篇重排一次源码，还会在撤销栈里留一步）。
  function groupPathChanged(path,target){
    var key=path.join('/');
    if(target.old!==undefined) return key!==target.old;
    var changed=false;
    state.ir.lanes.forEach(function(l){
      if(target.lanes.indexOf(l.id)>=0 && l.groupPath.join('/')!==key) changed=true;
    });
    return changed;
  }
  // 输入 → 路径数组。**只切分，不解释**：`/` 是分隔符，空段丢弃（`a//b` 与 `a/b` 等价，
  // 前导 `/` 与尾随 `/` 都不带语义），空串 = 空数组 = 不属于任何组。
  function groupPathOf(raw){
    return String(raw===undefined||raw===null?'':raw)
      .split('/').map(function(p){ return p.trim(); }).filter(function(p){ return p.length; });
  }
  // 一段行的最长公共分组前缀（数组）；不共享任何一段就是空数组
  function commonPath(paths){
    if(!paths.length) return [];
    var out=paths[0].slice();
    paths.forEach(function(p){
      var n=0; while(n<out.length&&n<p.length&&out[n]===p[n]) n++;
      out=out.slice(0,n);
    });
    return out;
  }

  // 就地编辑的唯一入口：双击（桌面）/ 双敲 / 长按（触摸）都走这里
  function openEditorFor(c){
    if(!c) return;
    // 长按是绕开 dispatchTarget 进来的，尺子不会被自动收下 —— 两种编辑态并存会让「拖哪儿改什么」
    // 变得不可预测。就地编辑开始前先结算尺子（值保留）。
    if(state.phaseEdit) closePhaseEdit(true);
    var snap={lane:c.lane,tick:c.tick,nameLane:c.nameLane,edgeIdx:c.edgeIdx,group:c.group};
    if(!(snap.nameLane||snap.edgeIdx!==undefined||snap.group!==undefined||(snap.lane!==undefined&&snap.tick!==undefined))) return;
    ctx.painting=null; state.connect=null;
    ctx.redraw(); openInlineFor(snap);
  }

  // ---- 统一输入层 -------------------------------------------------------
  // 鼠标：mousedown / mousemove / mouseup（保留桌面拖拽漫刷与既有验收）
  // 触摸 / 笔：pointerdown / move / up / cancel，共用同一组命令与 EditOp
  // 触摸端不调 preventDefault，原生滚动与双指缩放照常可用；双击由「同目标 330ms
  // 内两次点按」识别，长按 480ms 是就地编辑的备用入口。
  var lastTap=null, longPress=null, longTimer=null, ignoreMouseUntil=0;

  function hitKey(c){
    if(!c) return '';
    if(c.edgeIdx!==undefined) return 'e'+c.edgeIdx;
    if(c.nameLane) return 'n'+c.nameLane;
    if(c.group!==undefined) return 'g'+c.group;
    if(c.lane!==undefined&&c.tick!==undefined) return 'c'+c.lane+'@'+c.tick;
    return JSON.stringify(c);
  }
  function touchDetail(c){
    var now=Date.now(), key=hitKey(c);
    if(lastTap&&lastTap.key===key&&now-lastTap.time<330){ lastTap=null; return 2; }
    lastTap={key:key,time:now}; return 1;
  }
  function clearLong(){
    if(longTimer){ clearTimeout(longTimer); longTimer=null; }
    longPress=null;
  }
  function editable(c){
    if(!c) return false;
    if(c.edgeIdx!==undefined||c.nameLane||c.group!==undefined) return true;
    // 「格本身」才可编辑：同一条 lane 上的其它命中（φ/T 徽标、整行空白）不算格子。
    return c.lane!==undefined&&c.tick!==undefined&&
      c.meta===undefined&&c.col===undefined&&c.rowLane===undefined;
  }
  function startLong(c,x,y){
    clearLong();
    if(!editable(c)) return;
    longPress={x:x,y:y,c:c};
    longTimer=setTimeout(function(){
      longTimer=null;
      var p=longPress; longPress=null;
      if(!p) return;
      lastTap=null;
      press=null;          // 长按已经消费了这次按压，抬手时不再当成 tap 重复执行
      openEditorFor(p.c);
    },480);
  }

  // ---- 触摸输入状态机 ---------------------------------------------------
  // 手指按下 ≠ 点了。触摸端把「按下」只当候选：抬手时位移 ≤12px、时长 ≤500ms
  // 才确认是一次 tap，确认之后才改选中 / 执行命令 / 进编辑。画布上滑动（看别的列、
  // 看下面的行）因此永远不会顺手选中格子或弹面板 —— 「移动」与「编辑」不再靠猜。
  // 桌面（鼠标）仍是按下即分派：那里有拖拽漫刷与行重排，需要 mousedown 就建状态。
  var press=null;

  function handleDown(e,isTouch){
    if(e.button!==undefined&&e.button!==0) return;
    // 就地输入框也在 SVG 里，点它自己不能触发结算
    if(e.target&&e.target.getAttribute&&e.target.getAttribute('class')==='inline-edit') return;
    // 相位尺自带手势：按下即定位、拖动连续改。必须在 touch 的「候选 tap」之前返回，
    // 否则一次拖动会被后面的 tap 判定再派发一次。
    // 相位模式：在**这一行**的波形上按下就是「抓波形」（0.14.5）。不再有滑块命中区 ——
    // 整行的淡底与刻度都是 pointer-events:none，命中落在 rect.cell 上，所以一次轻点
    // 仍然能选中格子，并顺手退出相位模式。
    if(state.phaseEdit){
      var pc=cellAt(e);
      if(pc&&pc.lane===state.phaseEdit.lane&&pc.tick!==undefined){
        e.preventDefault&&e.preventDefault();
        startPhaseDrag(e);
        return;
      }
    }

    if(isTouch){
      // 只记候选，什么都不改：滑动（pan）与点按（tap）在抬手时才分得清
      press={x:e.clientX||0, y:e.clientY||0, c:cellAt(e), t:Date.now()};
      if(!state.readonly) startLong(press.c, press.x, press.y);   // 长按＝就地编辑的第二入口
      return;
    }

    // 桌面只读态：点一下进编辑并顺手选中被点的格子，本次点击不产生任何编辑
    if(state.readonly){
      e.preventDefault&&e.preventDefault();
      var rc=cellAt(e);
      var hit=rc&&rc.lane!==undefined&&rc.tick!==undefined&&!rc.cmd?{lane:rc.lane,tick:rc.tick}:null;
      if(hit){ state.selCell=hit; state.selLane=hit.lane; state.sel=null; }
      if(ctx.requestEdit) ctx.requestEdit(hit?{x:e.clientX,y:e.clientY,cell:hit}:null);
      return;
    }
    dispatchTarget(cellAt(e), e, false);
  }

  // 命中目标的分派：桌面在 mousedown 调用，触摸在 tap 确认后调用 —— 两边共用同一份逻辑，
  // 差别只在双击识别方式（鼠标 e.detail / 触摸的 330ms 同目标二次 tap）与是否建拖拽状态。
  function dispatchTarget(c,e,isTouch){
    // 先解析命中目标，避免提交编辑后的重绘让 e.target 变成游离节点
    var dbl=isTouch?touchDetail(c):(e.detail>1?2:1);
    if(ctx.inlineCtx) closeInline(true);
    if(state.phaseEdit) closePhaseEdit(true);
    if(!c){
      // 点到画布空白 = 清掉选中。四场景一致：桌面本来有 Esc，触摸端没有键盘 ——
      // 这条手势就是触摸端唯一的「取消选中」，让底部动作行（#tbpanel）成为唯一的上下文入口。
      if(state.selCell||state.selLane||state.selRows||(state.sel!==null&&state.sel!==undefined)){
        state.selCell=null; state.sel=null; state.selLane=null;
        if(ctx.clearSpan) ctx.clearSpan();
        ctx.redraw();
      }
      return;
    }
    // 零行空态占位行：整块就是一个「加第一条信号行」的按钮
    if(c.empty){
      if(dbl>1) return;
      e.preventDefault();
      ctx.commit({t:'addLane',id:'ln'+Date.now().toString(36),name:'new',at:0,kind:'signal'},'add signal row');
      return;
    }
    // 全局命令（撤销 / 重做 / 连线开关）在两种模式下都可用
    if(c.cmd){ if(dbl>1) return; e.preventDefault(); ctx.doCmd(c.cmd); return; }
    // 互斥分派：连线模式开启时，同一片 rect.cell 只作为连线端点，其余编辑入口
    // 一律不响应；关闭时完全走时序编辑链路，不会因为点到波形就误触发连线。
    if(state.linkMode){
      if(dbl>1){ e.preventDefault(); return; }
      // 落在波形格区域内的命中（含数据标签徽标）一律视为同一操作区域；弧线命中带已在绘制层让位，列头 / 行工具 / 字符条 / 弧线一概不响应。
      if(c.lane!==undefined&&c.tick!==undefined){
        e.preventDefault();
        var el=findLane(c.lane);
        if(!el||el.kind!=='signal'||!el.slots[c.tick]){
          ctx.notify('That period is not defined in the source yet',true,cellTarget(c.lane,c.tick)); return;
        }
        state.linkCursor={lane:c.lane,tick:c.tick};
        handleAnchor({lane:c.lane,tick:c.tick,node:nodeChar(c.lane,c.tick)});
      }
      return;
    }
    if(c.meta){
      if(dbl>1) return;
      e.preventDefault();
      // 行名旁的 φ / T 都是「一个数」→ 直接就地输入（Enter 确认 / Esc 取消）。
      // 相位的**图形化粗调**不占这个入口：它挂在上下文条（`#tbpanel`）的 φ 按钮上，
      // 进模式后抓这一行的波形横拖。分工：行名给精确值（敲 0.35 一步到位），上下文条给手感
      // （拖着看波形怎么挪）。两条路随时都在、互不打断 —— 拖完想精调就点数字，敲完想微调就去拖。
      openRowEditor(c.lane,c.meta);
      return;
    }
    if(c.group!==undefined){ if(dbl>1) return; e.preventDefault(); openGroupEditor(c.group); return; }
    if(c.col!==undefined){
      if(dbl>1) return;
      e.preventDefault(); state.sel=c.col;
      // 列选中与格 / 行选中互斥 —— **四场景一致**（原先只在触摸端清，桌面点列头后面板
      // 仍停在「格级动作」上，因为 renderContext 的优先级是 格 > 列 > 行）。0.9.12 修行
      // 分支时漏了这一处，同一个 `if(TOUCH)` 的残留。
      state.selCell=null; state.selLane=null;
      if(ctx.clearSpan) ctx.clearSpan();
      ctx.redraw(); ctx.status(); return;
    }
    if(c.nameLane||c.rowLane){
      // Shift + 点行名 = 从当前行（锚点）扩到这一行，得到一段连续行范围。
      // 分组按「一段连续行」表达，这是桌面上表达范围的第二个入口（键盘是 Shift+↑/↓）。
      var rowId=c.nameLane||c.rowLane;
      if(e.shiftKey&&state.selLane&&state.selLane!==rowId&&ctx.setRowSpan){
        ctx.setRowSpan(state.selLane,rowId,state.selLane);
        state.selCell=null; state.sel=null; ctx.redraw(); return;
      }
      state.selLane=rowId;
      if(ctx.clearSpan) ctx.clearSpan();
      // 行选中与格 / 列选中互斥 —— 四场景一致。桌面现在也靠上下文条改行列（行工具与
      // 列头按钮已撤），若不清掉 selCell，renderContext 会因「有格子选中」而把面板收起来，
      // 表现为「点了行但右侧面板不出现」。
      state.selCell=null; state.sel=null;
      // 双击 / 双敲才进就地编辑；单击只选中行（否则面板会被 inlineCtx 抑制掉）
      if(dbl>1){ e.preventDefault(); if(editable(c)) openEditorFor(c); return; }
      ctx.redraw(); return;
    }

    // 其余目标（格子、行内空白）双击 / 双敲 → 就地编辑
    if(dbl>1){
      e.preventDefault();
      if(!editable(c)) return;
      openEditorFor(c);
      return;
    }
    if(c.edgeIdx!==undefined){
      if(dbl>1){ e.preventDefault(); openEditorFor(c); return; }
      e.preventDefault(); state.selLane=null; ctx.redraw(); return;
    }
    // 单击格子只选中，不写入；写入统一由 writeChar（键盘 / 字符条）完成
    e.preventDefault();
    if(isTouch){
      state.selCell={lane:c.lane,tick:c.tick}; state.selLane=c.lane;
      state.sel=null; ctx.painting=null; ctx.redraw();
      return;
    }
    state.selCell={lane:c.lane,tick:c.tick}; state.selLane=c.lane;
    // 漫刷不碰 piece-wise 行：那里没有字符格可刷，刷了就是把路径换成字符串（选中仍然允许）
    var pl=findLane(c.lane);
    ctx.painting=(pl&&pl.waveRaw)?null:{ lane:c.lane, ticks:[], v:state.ch, base:{ir:state.ir,src:code.value,sel:state.sel}, moved:false };
    // 先建立选中再聚焦：focus 事件的 ensureSelCell 看到已有选中格就不会多绘一次
    ctx.focusCanvas();
    ctx.redraw();
  }
  // 屏幕坐标 → SVG 用户坐标。视图可能是等比缩小过的（触摸端 / 看卡片），
  // 所以必须按 viewBox 与渲染尺寸的比例换算，不能拿 clientX-rect.left 直接当用户坐标 ——
  // 那是 1:1 时代的老假设，缩放后预览弧线会整体偏移。
  function svgXY(cx,cy){
    var svg=svgRoot(); if(!svg) return {x:cx,y:cy};
    var r=svg.getBoundingClientRect(), vb=svg.viewBox&&svg.viewBox.baseVal;
    var kx=(vb&&r.width)?vb.width/r.width:1, ky=(vb&&r.height)?vb.height/r.height:1;
    return {x:(cx-r.left)*kx+(vb?vb.x:0), y:(cy-r.top)*ky+(vb?vb.y:0)};
  }

  function showConnectPreview(mx,my){
    var svg=svgRoot(); if(!svg||!state.connect) return;
    var p=svg.querySelector('path.connectPreview');
    if(!p){ p=document.createElementNS('http://www.w3.org/2000/svg','path'); p.setAttribute('class','connectPreview'); svg.appendChild(p); }
    var a=state.connect, ln=findLane(a.lane);
    var ax=ln?cellGeo(ln,a.tick).cx:G.XS+a.tick*G.CELL+G.CELL/2, ay=TOP+a.li*ROW_H+7;
    p.setAttribute('d','M'+ax+','+ay+' C'+(ax+10)+','+(ay-26)+' '+(mx-10)+','+(my-26)+' '+mx+','+my);
  }

  // 触摸后浏览器会补发一套兼容鼠标事件。只靠 800ms 时间窗挡不住长按：按住 1.2 秒再抬手，
  // 窗口早就过期，合成的 mousedown 会被当成桌面点击 —— 表现为「长按打开就地编辑，
  // 一抬手编辑框被关掉、格子反而被选中」，只读卡片里更糟（长按抬手直接进了编辑态）。
  // 有 sourceCapabilities 就按「这次事件是否由触摸产生」判断，时间窗只作老浏览器兜底。
  function syntheticMouse(e){
    if(e.sourceCapabilities&&e.sourceCapabilities.firesTouchEvents) return true;
    return Date.now()<ignoreMouseUntil;
  }
  wrap.addEventListener('mousedown',function(e){
    if(syntheticMouse(e)) return;
    handleDown(e,false);
  });
  wrap.addEventListener('mousemove',function(e){
    if(movePhaseDrag(e)) return;
    var svg=svgRoot();
    if(state.connect&&svg){
      var q=svgXY(e.clientX,e.clientY); showConnectPreview(q.x,q.y);
    }
    var hc=cellAt(e);
    if(!ctx.painting||!e.buttons) return;
    var c=hc;
    if(!c||c.lane===undefined||c.tick===undefined||c.lane!==ctx.painting.lane||ctx.painting.ticks.indexOf(c.tick)>=0) return;
    ctx.painting.ticks.push(c.tick); ctx.painting.moved=true;
    state.ch=ctx.painting.v; state.selCell={lane:c.lane,tick:c.tick};
    ctx.commit({t:'setSlot',lanes:[c.lane],tick:c.tick,v:ctx.painting.v},'paint @ t'+c.tick,true,true);
  });
  // 点到画布之外（源码框 / 顶栏 / 分享面板 / 页面空白）也要结算相位编辑，
  // 否则会留一把悬空的尺子挂在图上。用 capture：先把手势收成一步，再让目标控件自己的处理跑。
  document.addEventListener('mousedown',function(e){
    if(!state.phaseEdit) return;
    var t=e.target;
    if(t&&wrap.contains&&wrap.contains(t)) return;
    closePhaseEdit(true);
  },true);
  document.addEventListener('pointerdown',function(e){
    if(!state.phaseEdit||e.pointerType==='mouse') return;
    var t=e.target;
    if(t&&wrap.contains&&wrap.contains(t)) return;
    closePhaseEdit(true);
  },true);
  document.addEventListener('mouseup',function(e){
    if(e&&syntheticMouse(e)) return;
    if(ctx.phaseDrag){ ctx.phaseDrag=false; flushPhaseStep(); return; }
    if(endPhaseTap(false)) return;
    if(!ctx.painting) return;
    var p=ctx.painting; ctx.painting=null;
    if(p.moved){
      state.undo.push(p.base); if(state.undo.length>60) state.undo.shift(); state.redo.length=0;
    }
  });

  // 非鼠标指针：统一转成不阻止默认行为的轻量事件对象，保留原生滚动。
  // pointerId / isPrimary 必须带上 —— 相位拖动要靠 pointerId 把指针捕获设到 wrap、
  // 第二根手指要靠 isPrimary 认（以前 shim 漏了 pointerId，那句 setPointerCapture 从来没生效过）。
  function pointerShim(e){
    return { target:e.target, button:0, detail:0, clientX:e.clientX||0, clientY:e.clientY||0,
             pointerId:e.pointerId, pointerType:e.pointerType, isPrimary:e.isPrimary,
             preventDefault:function(){} };
  }

  // ---- 触摸端的两个手势层 -----------------------------------------------------
  // ①「这一下从哪开始」定语义（0.14.2）：起点在相位尺上＝改相位；起点在别处＝移动视图；
  //    第二根手指落下＝移动视图，并把本次手势改出的相位撤回。
  // ② 手势开始之后，**坐标一律从 document 收**（0.14.3）：手指很容易滑出画布 ——
  //    相位尺在小卡片上只有 87px 宽，尺子外平移更是要滑很远。只听 wrap 上的 pointermove，
  //    滑出去就再也没有事件，表现为「按下去跳到某个值，之后怎么拖都不动」。
  //    document 用 capture 阶段装，任何元素 stopPropagation 都挡不住。
  var tPts={}, tPan=null, tDown=null, tActive=false, tLast=0;
  var T_STALE=2500;                       // 单个指针多久没有事件就认定它丢了
  var T_GAP=1200;                         // 两次手势之间超过这个间隔：上一段一定已经结束
  var T_HOLD=600;                         // 一条记账多久没更新就不再当作「还按着的手指」
  function tid(e){ return e.pointerId===undefined?0:e.pointerId; }
  function tPrune(){
    var now=Date.now(), ks=Object.keys(tPts), i;
    for(i=0;i<ks.length;i++) if(now-tPts[ks[i]].t>T_STALE) delete tPts[ks[i]];
  }
  function tCount(){ tPrune(); return Object.keys(tPts).length; }
  function tReset(){ tPts={}; tPan=null; tDown=null; tActive=false; tLast=0; }
  function tCentroid(){
    var ks=Object.keys(tPts); if(!ks.length) return null;
    var sx=0, sy=0, i;
    for(i=0;i<ks.length;i++){ sx+=tPts[ks[i]].x; sy+=tPts[ks[i]].y; }
    return { x:sx/ks.length, y:sy/ks.length };
  }
  function tPanStart(){
    var c=tCentroid(); if(!c) return;
    tPan={ x:c.x, y:c.y, left:wrap.scrollLeft, top:wrap.scrollTop };
  }
  function tPanMove(){
    if(!tPan) return false;
    var c=tCentroid(); if(!c) return false;
    wrap.scrollLeft=tPan.left-(c.x-tPan.x);
    wrap.scrollTop =tPan.top -(c.y-tPan.y);
    return true;
  }
  function tDropPoint(id){ delete tPts[id]; if(!tCount()){ tPan=null; tDown=null; tActive=false; } }
  // 从「改相位」切到「移动视图」：把**本次手势**改出来的值撤回去（用户改主意了，这一步不算编辑），
  // 然后以当前位置重新起锚。两指一落下就把相位改了属于典型的误操作。
  function tHandOffToPan(){
    var pe=state.phaseEdit, l=pe&&findLane(pe.lane);
    if(pe&&l&&pe.gest0!==undefined&&l.phase!==pe.gest0){
      ctx.commit({t:'setPhase',lane:pe.lane,v:pe.gest0},'phase',true,true);
      pe.pending=null;                       // 净变化为零，撤销栈里不留这一步
    }
    ctx.phaseDrag=false;
    tPanStart();
  }

  wrap.addEventListener('pointerdown',function(e){
    if(e.pointerType==='mouse') return;
    if(e.target&&e.target.getAttribute&&e.target.getAttribute('class')==='inline-edit') return;
    if(e.isTrusted) ignoreMouseUntil=Date.now()+800;
    var id=tid(e), cx=e.clientX||0, cy=e.clientY||0, now=Date.now();
    // 上一次手势没收到抬手：按「间隔」判定它已经结束，先清账再开始这一次。
    // 否则残留的指针会污染这次的质心（平移一跳），tDown 也建不起来。
    if(!tActive||now-tLast>T_GAP) tReset();
    tActive=true; tLast=now;
    // 先把「早就没动过的记账」清掉：抬手丢了之后它会一直躺在账上，
    // 让下一次按下被误判成第二根手指。
    Object.keys(tPts).forEach(function(k){ if(now-tPts[k].t>T_HOLD) delete tPts[k]; });
    tPts[id]={ x:cx, y:cy, t:now };
    if(tCount()===1){ tDown={ x:cx, y:cy }; tPan=null; }
    // 第二根手指：`isPrimary` 是权威（真机第一根手指一定是 true），但它**不能单独用** ——
    // 合成事件的 isPrimary 默认是 false，只看它会把每一次合成点按都当成第二根手指。
    // 所以要求「明确声明不是 primary」且「账上确实还有一根按着的手指」。
    if(e.isPrimary===false&&tCount()>1){ tHandOffToPan(); return; }
    handleDown(pointerShim(e),true);
  });

  document.addEventListener('pointermove',function(e){
    if(e.pointerType==='mouse'||!tActive) return;
    var id=tid(e), cx=e.clientX||0, cy=e.clientY||0;
    if(tPts[id]){ tPts[id].x=cx; tPts[id].y=cy; tPts[id].t=Date.now(); tLast=tPts[id].t; }
    else if(!(tPan||ctx.phaseDrag)) return;   // 不认识的指针、也没有进行中的手势
    if(tPan){ tPanMove(); return; }
    // 相位模式：**按下时是「待命」，过了死区才算拖动** —— 所以这两态都要交给 movePhaseDrag。
    // （0.14.5 第一版漏了「待命」这一支，结果触摸端按下后怎么拖都不动，只有桌面能动。）
    if(ctx.phaseDrag||(state.phaseEdit&&state.phaseEdit.armed)){
      // 竖向为主 = 想上下看：改判为移动视图，别把竖向手势卡成「没有反应」
      if(tDown&&Math.abs(cy-tDown.y)>14&&Math.abs(cy-tDown.y)>Math.abs(cx-tDown.x)*1.5){
        if(state.phaseEdit) state.phaseEdit.armed=false;
        tHandOffToPan(); tPanMove(); return;
      }
      movePhaseDrag(e);
      return;
    }
    // 手指移动超过 12px 就判定为「滑动看图」（pan）：作废候选 tap 与长按计时，
    // 本次手势不产生任何选中 / 弹出 / 编辑 —— 这是「移动 vs 编辑」的分界线。
    if(press&&(Math.abs(cx-press.x)>12||Math.abs(cy-press.y)>12)){
      press=null; clearLong();
      // 尺子开着时画布没有原生滚动可依赖（`.is-phase` 把 touch-action 关掉了），
      // 这次拖动由我们接手成平移，并顺手把尺子收下 —— 与「点别处」同一个结果。
      // 注意：只有这一支才 return；其余情况要继续往下走，否则连线模式的跟手预览会断。
      if(state.phaseEdit){ closePhaseEdit(true); tPanStart(); tPanMove(); return; }
    }
    if(longPress&&(Math.abs(cx-longPress.x)>12||Math.abs(cy-longPress.y)>12)) clearLong();
    // 触摸端也跟手画连线预览曲线：记录第一个端点后，曲线末端跟着手指走
    if(state.connect){
      var svg=svgRoot();
      if(svg){
        var q2=svgXY(cx,cy); showConnectPreview(q2.x,q2.y);
      }
    }
  },true);

  // 抬手才算数：位移 ≤12px、时长 ≤500ms 才是一次 tap，其余一律视为滑动（不改任何状态）。
  function confirmTap(cx,cy){
    var p=press; press=null;
    clearLong();
    if(!p) return;
    var x=cx, y=cy;
    // 少数合成事件 / 老设备在抬手事件上不带坐标（都是 0）：退回按下时的位置，
    // 否则一次正常的点按会被算成「滑了很远」而失效。
    if(!x&&!y){ x=p.x; y=p.y; }
    if(Math.abs(x-p.x)>12||Math.abs(y-p.y)>12) return;
    if(Date.now()-p.t>500) return;
    if(state.readonly){
      var rc=p.c;
      var hit=rc&&rc.lane!==undefined&&rc.tick!==undefined&&!rc.cmd?{lane:rc.lane,tick:rc.tick}:null;
      if(hit){ state.selCell=hit; state.selLane=hit.lane; state.sel=null; }
      if(ctx.requestEdit) ctx.requestEdit({x:p.x,y:p.y,cell:hit});
      return;
    }
    // p.c 为 null = 点在画布空白：同样派发，dispatchTarget 用它清选中（触摸端没有 Esc，
    // 这是唯一取消手势）；有命中时是普通的图元点击。
    dispatchTarget(p.c, {clientX:p.x, clientY:p.y, detail:0, preventDefault:function(){}}, true);
  }
  function endPointer(e){
    if(e.pointerType==='mouse') return;
    tLast=Date.now();
    if(!tActive) return;
    tDropPoint(tid(e));
    if(ctx.phaseDrag){ ctx.phaseDrag=false; flushPhaseStep(); return; }
    if(endPhaseTap(true)) return;
    confirmTap(e.clientX||0,e.clientY||0);
  }
  document.addEventListener('pointerup',endPointer,true);
  document.addEventListener('pointercancel',function(e){
    if(e.pointerType==='mouse') return;
    clearLong(); press=null;
    if(!tActive) return;
    tDropPoint(tid(e));
    // 手势被系统 / 浏览器收走（来电话、系统手势、滚动仲裁漏网）：值保留、但必须把这一串
    // 收成**一步撤销** —— 只是 `phaseDrag=false` 会让这次改动永远进不了撤销栈。
    if(ctx.phaseDrag){ ctx.phaseDrag=false; flushPhaseStep(); }
  },true);
  // 兜底：捕获丢失 / 页面被切走时把手势状态清干净。少了这一层，一次丢事件就会让
  // 手势记账长期停在「有一根手指还在按」，之后的点按与拖动全部错判。
  wrap.addEventListener('lostpointercapture',function(){ if(!ctx.phaseDrag) tReset(); });
  window.addEventListener('blur',function(){
    clearLong(); press=null;
    if(ctx.phaseDrag){ ctx.phaseDrag=false; flushPhaseStep(); }
    tReset();
  });
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden) return;
    clearLong(); press=null;
    if(ctx.phaseDrag){ ctx.phaseDrag=false; flushPhaseStep(); }
    tReset();
  });

  // 没有 Pointer Events 的老浏览器：用 touch 事件回退，命中点交给 elementFromPoint
  if(typeof window!=='undefined'&&!window.PointerEvent){
    function touchShim(e){
      var t=e.touches&&e.touches[0]?e.touches[0]:(e.changedTouches&&e.changedTouches[0]);
      if(!t) return null;
      var target=document.elementFromPoint(t.clientX,t.clientY)||e.target;
      return { target:target, button:0, detail:0, clientX:t.clientX, clientY:t.clientY,
               preventDefault:function(){} };
    }
    wrap.addEventListener('touchstart',function(e){
      var s=touchShim(e); if(!s) return;
      if(e.isTrusted) ignoreMouseUntil=Date.now()+800;
      handleDown(s,true);
    },{passive:true});
    wrap.addEventListener('touchmove',function(e){
      var t=e.touches&&e.touches[0]; if(!t) return;
      if(press&&(Math.abs(t.clientX-press.x)>12||Math.abs(t.clientY-press.y)>12)){ press=null; clearLong(); }
      if(longPress&&(Math.abs(t.clientX-longPress.x)>12||Math.abs(t.clientY-longPress.y)>12)) clearLong();
      if(state.connect){
        var svg=svgRoot();
        if(svg){ var q3=svgXY(t.clientX,t.clientY); showConnectPreview(q3.x,q3.y); }
      }
    },{passive:true});
    document.addEventListener('touchend',function(e){
      var t=e.changedTouches&&e.changedTouches[0];
      confirmTap(t?t.clientX:0, t?t.clientY:0);
    },{passive:true});
    document.addEventListener('touchcancel',function(){ clearLong(); press=null; },{passive:true});
  }

  // ---- 键盘：不用鼠标完成全部编辑 -------------------------------------------
  // 普通状态：方向键 / Home / End 移动选中格，波形字符直通写入，Enter 系列就地编辑，
  // 单字母命令覆盖行 / 列 / 对象 / 弧线 / 重排 / 连线；连线模式另有一套端点光标分派。
  // 两种模式仍互斥：连线模式下字符写入、就地编辑与选中一律不响应。
  var NAV=/^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End)$/;
  function prevent(e){ if(e.preventDefault) e.preventDefault(); }
  function otherControl(){
    var ae=document.activeElement;
    return !!(ae&&ae!==document.body&&ae!==wrap&&!wrap.contains(ae)&&
      /^(BUTTON|A|SELECT|TEXTAREA|INPUT)$/.test(ae.tagName||''));
  }
  function sigIndex(from,dir){
    var ls=state.ir.lanes, i=from;
    for(var n=0;n<ls.length;n++){
      i+=dir;
      if(i<0||i>=ls.length) return from;
      if(ls[i].kind==='signal') return i;
    }
    return from;
  }
  function firstSig(){ var ls=state.ir.lanes; for(var i=0;i<ls.length;i++) if(ls[i].kind==='signal') return i; return -1; }
  function lastSig(){ var ls=state.ir.lanes; for(var i=ls.length-1;i>=0;i--) if(ls[i].kind==='signal') return i; return -1; }
  function ensureSel(){
    if(!state.ir||state.linkMode) return null;
    if(!state.selCell) ctx.ensureSelCell();
    return ctx.clampSel();
  }
  function moveSel(k,e){
    var sc=ensureSel(); if(!sc) return;
    var N=state.ir.ticks, ls=state.ir.lanes, li=-1;
    ls.forEach(function(l,i){ if(l.id===sc.lane) li=i; });
    var nt=sc.tick, ni=li;
    if(k==='ArrowLeft') nt=Math.max(0,sc.tick-1);
    else if(k==='ArrowRight') nt=Math.min(N-1,sc.tick+1);
    else if(k==='Home') nt=0;
    else if(k==='End') nt=N-1;
    else ni=sigIndex(li,k==='ArrowUp'?-1:1);
    if(e.ctrlKey||e.metaKey){
      if(k==='Home') ni=firstSig();
      if(k==='End') ni=lastSig();
    }
    if(ni<0) ni=li;
    state.selCell={lane:(ls[ni]||ls[li]).id,tick:nt};
    state.selLane=state.selCell.lane;
    ctx.redraw();
  }
  function moveLaneByKeyboard(dir){
    var sc=ensureSel(); if(!sc) return;
    ctx.commit({t:'moveLane',lane:sc.lane,v:dir},dir==='up'?'move row up':'move row down');
    ctx.clampSel(); ctx.redraw();
  }
  function editEdge(next){
    var n=state.ir.edges.length;
    if(!n){ ctx.notify('No edges yet — press K to create one',true); return; }
    if(next) state.edgeIdx=((state.edgeIdx||0)+1)%n;
    if(state.edgeIdx>=n) state.edgeIdx=0;
    ctx.openEdgeEditor(state.edgeIdx);
  }
  function command(k,e,sc){
    if(e.ctrlKey||e.metaKey||e.altKey) return false;
    var lane=findLane(sc.lane);
    function needSignal(){
      if(!lane||lane.kind==='spacer'){ ctx.notify('This is a spacer row — move to a signal row first',true,laneRowEl(sc.lane)); return false; }
      return true;
    }
    switch(k){
      case 'k': ctx.setLinkMode(true); return true;                       // 连线模式开关
      case 'r': if(needSignal()) ctx.openInlineFor({nameLane:sc.lane}); return true;
      case 'w': case 'a': case 's': case 'f': case 't':                  // 整行 / 相位 / 周期
        if(needSignal()) ctx.openRowEditor(sc.lane,{w:'wave',a:'data',s:'node',f:'phase',t:'period'}[k]);
        return true;
      case 'b': if(needSignal()) ctx.openLabelEditor(sc.lane,sc.tick); return true;
      case 'e': case 'E': editEdge(k==='E'); return true;                 // 编辑 / 切换弧线
      case 'o': case 'O': case 'X':                                       // 增行 / 空行 / 删行
        ctx.handleTool(k==='o'?'add':k==='O'?'spacer':'del',sc.lane);
        ctx.clampSel(); ctx.redraw(); return true;
      case '+': case '-': case 'g': case 'A':                            // 列增删 / 相位线 / 末尾追加
        ctx.handleColAct(k==='+'||k==='A'?'insert':k==='-'?'delete':'gap',
                         k==='A'?state.ir.ticks:sc.tick);
        ctx.clampSel(); ctx.redraw(); return true;
    }
    return false;
  }
  function linkKeys(e){
    var k=e.key;
    if(k==='Escape'||k==='k'||k==='K'){ prevent(e); ctx.setLinkMode(false); return; }
    var lc=state.linkCursor;
    if(k==='Enter'||k===' '||k==='Spacebar'){
      prevent(e);
      if(!lc){ ctx.notify('No signal rows available as link endpoints',true); return; }
      var l=findLane(lc.lane);
      if(!l||l.kind!=='signal'||!l.slots[lc.tick]){
        ctx.notify('That period is not defined in the source yet',true,cellTarget(lc.lane,lc.tick)); return;
      }
      handleAnchor({lane:lc.lane,tick:lc.tick,node:nodeChar(lc.lane,lc.tick)});
      return;
    }
    if(NAV.test(k)){
      prevent(e);
      if(lc&&state.ir){
        var N=state.ir.ticks, ls=state.ir.lanes, li=-1;
        ls.forEach(function(l,i){ if(l.id===lc.lane) li=i; });
        var nt=lc.tick, ni=li;
        if(k==='ArrowLeft') nt=Math.max(0,lc.tick-1);
        else if(k==='ArrowRight') nt=Math.min(N-1,lc.tick+1);
        else if(k==='Home') nt=0;
        else if(k==='End') nt=N-1;
        else ni=sigIndex(li,k==='ArrowUp'?-1:1);
        if(ni<0) ni=li;
        state.linkCursor={lane:(ls[ni]||ls[li]).id,tick:nt};
        ctx.redraw();
      }
      return;
    }
    // 连线模式：波形字符、命令键、就地编辑一律不响应
  }

  document.addEventListener('keydown',function(e){
    var t=e.target||{}, typing=/^(TEXTAREA|INPUT|SELECT)$/.test(t.tagName||'')||t.isContentEditable;
    // F6 在源码框里也能用；Tab 按浏览器默认顺序同样可达画布
    if(e.key==='F6'){
      prevent(e);
      var ae=document.activeElement;
      ctx.focusPane(ae===code?'diagram':((ae===wrap||wrap.contains(ae))?'src':'diagram'));
      return;
    }
    if(e.key==='Escape'&&state.linkMode){ ctx.setLinkMode(false); return; }
    if((e.ctrlKey||e.metaKey)&&/^(z|y)$/i.test(e.key)&&!typing){
      prevent(e);
      if(state.phaseEdit) closePhaseEdit(true);   // 先把相位编辑收成一步，再执行撤销
      ctx.doCmd((e.shiftKey||/^y$/i.test(e.key))?'redo':'undo'); return;
    }
    // 相位尺打开时接管键盘：Esc = 取消（值还原）、Enter = 收下、←→ 微调、0 = 归零。
    // 位置很关键 —— 必须排在 otherControl() **之前**：尺子是从上下文条 / φ 徽标点开的，
    // 焦点还留在那个按钮上，otherControl() 会直接 return，Esc 与方向键就都失灵了。
    // 也必须排在下面的「Esc 逐层退出」之前，否则一次 Esc 会连选中一起清掉。
    if(state.phaseEdit&&!typing){
      var pk=e.key;
      if(pk==='Escape'){ prevent(e); e.stopPropagation(); closePhaseEdit(false); return; }
      if(pk==='Enter'||pk===' '||pk==='Spacebar'){ prevent(e); closePhaseEdit(true); return; }
      if(pk==='ArrowLeft'||pk==='ArrowRight'){
        prevent(e);
        var pl=findLane(state.phaseEdit.lane);
        // 方向与拖动一致：← 波形左移（phase 变大）、→ 波形右移（phase 变小）
        var step=(pk==='ArrowLeft'?1:-1)*(e.shiftKey?0.5:PHASE_STEP);
        if(pl) applyPhase(+Math.max(0,pl.phase+step).toFixed(2));
        return;
      }
      if(pk==='0'){ prevent(e); applyPhase(0); return; }
    }
    if(typing||otherControl()) return;
    // 只读态不响应任何编辑键；Esc 由卡片外层负责退出编辑态。
    if(state.readonly) return;
    if(state.linkMode){ linkKeys(e); return; }
    var k=e.key;
    // Esc 逐层退出：就地编辑框 → 选中（本节）→ 编辑态（embed-shell 那一层）。
    // 这一层必须 stopPropagation，否则一次 Esc 同时清选中又退出编辑，用户分不清发生了什么。
    if(k==='Escape'&&(state.selCell||state.selLane||state.selRows||state.sel!==null&&state.sel!==undefined)){
      prevent(e); e.stopPropagation();
      state.selCell=null; state.selLane=null; state.sel=null;
      if(ctx.clearSpan) ctx.clearSpan();
      if(ctx.closeCharDock) ctx.closeCharDock();
      ctx.redraw(); return;
    }
    // Shift+↑/↓ = 把行范围向外推一行。必须放在 ensureSel 之前：ensureSel 在「没有选中格」
    // 时会补一个格子并改写 selLane，放到后面就会拿被改写的行当锚点（实测从第 1 行开始扩）。
    if(e.shiftKey&&(k==='ArrowUp'||k==='ArrowDown')&&ctx.extendSpan){
      if(!state.selLane){ var f0=ensureSel(); if(f0) state.selLane=f0.lane; }
      ctx.extendSpan(k==='ArrowUp'?-1:1);
      return;
    }
    var sc=ensureSel(); if(!sc||!state.ir) return;
    var ctrl=e.ctrlKey||e.metaKey;
    if(!ctrl&&!e.altKey&&Core.ALL.indexOf(k)>=0){ prevent(e); writeChar(k); return; }
    // 节点字符没有专属锚点：选中格后 Shift+Enter 就地编辑该格 node
    if(k==='Enter'&&e.shiftKey){
      prevent(e);
      var nl=findLane(sc.lane);
      ctx.openNodeEditor(sc.lane,sc.tick,nl?nl.node[sc.tick]:''); return;
    }
    if(k==='Enter'){ prevent(e); ctx.openInlineFor({lane:sc.lane,tick:sc.tick}); return; }
    // Ctrl+↑ / ↓ 重排当前行（与方向键换格区分开）
    if(ctrl&&(k==='ArrowUp'||k==='ArrowDown')){
      prevent(e); moveLaneByKeyboard(k==='ArrowUp'?'up':'down'); return;
    }
    if(NAV.test(k)){
      prevent(e);
      if(e.shiftKey&&(k==='ArrowLeft'||k==='ArrowRight')){
        // 键盘漫刷：写入当前字符并沿方向移动，等价于按住鼠标横向拖过
        writeChar(state.ch||'1',k==='ArrowLeft'?'left':'right');
        return;
      }
      moveSel(k,e); return;
    }
    if(command(k,e,sc)) prevent(e);
  });
  ctx.svgRoot=svgRoot;
  ctx.findLane=findLane;
  ctx.closeInline=closeInline;
  ctx.openInline=openInline;
  // 触摸操作栏复用的动作（同一命令、同一 EditOp，不新增第二套编辑路径）
  ctx.openRowEditor=openRowEditor;
  ctx.openCellCharEditor=openCellCharEditor;
  ctx.writeChar=writeChar;
  ctx.revealSel=revealSel;
  ctx.revealLane=revealLane;
  ctx.openLabelEditor=openLabelEditor;
  ctx.openNodeEditor=openNodeEditor;
  ctx.openEdgeEditor=openEdgeEditor;
  ctx.openInlineFor=openInlineFor;
  ctx.openGroupEditor=openGroupEditor;
  ctx.openPhaseEdit=openPhaseEdit; ctx.closePhaseEdit=closePhaseEdit;
  ctx.openEditorFor=openEditorFor;
  ctx.handleTool=handleTool;
  ctx.handleColAct=handleColAct;
  ctx.cancelModes=function(){
    state.connect=null; state.linkMode=false; state.linkCursor=null;
    state.selCell=null; state.sel=null; state.selLane=null;
    if(ctx.clearSpan) ctx.clearSpan();
    ctx.painting=null; ctx.closeInline(false); ctx.redraw();
  };
}
