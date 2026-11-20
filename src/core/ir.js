// Canonical IR 内核：Parser / buildIR / emitIR / canon / 16 类 EditOp / patchSource。
// 纯 JS，零 DOM、零依赖；Node 自检与浏览器运行时共用同一份实现。
export const Core = (function () {
  'use strict';
  var BUS = /[=2-9]/, LEVEL = /[01xzud]/, CLOCK = /[pPnNhHlL]/;
  var ALL = ['0','1','x','z','u','d','p','P','n','N','h','l','H','L','=','2','3','4','5','6','7','8','9'];

  function Parser(src) { this.s = src; this.i = 0; }
  Parser.prototype.ws = function () {
    while (this.i < this.s.length) {
      var c = this.s[this.i];
      if (/\s/.test(c)) { this.i++; continue; }
      if (c === '/' && this.s[this.i+1] === '/') { while (this.i < this.s.length && this.s[this.i] !== '\n') this.i++; continue; }
      if (c === '/' && this.s[this.i+1] === '*') { this.i += 2; while (this.i < this.s.length && !(this.s[this.i] === '*' && this.s[this.i+1] === '/')) this.i++; this.i += 2; continue; }
      break;
    }
  };
  Parser.prototype.err = function (m) { var e = new Error(m + ' @' + this.i); e.pos = this.i; throw e; };
  Parser.prototype.value = function () {
    this.ws(); var s = this.i, c = this.s[this.i];
    if (c === '{') return this.obj();
    if (c === '[') return this.arr();
    if (c === '"' || c === "'") return this.str();
    if (c === '-' || /[0-9]/.test(c)) { var m = /^-?\d+(?:\.\d+)?/.exec(this.s.slice(this.i)); if (!m) this.err('bad number'); this.i += m[0].length; return { k:'num', v:Number(m[0]), s:s, e:this.i }; }
    var id = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i));
    if (id) { this.i += id[0].length; var v = id[0]==='true'?true:id[0]==='false'?false:id[0]; return { k:'id', v:v, s:s, e:this.i }; }
    this.err('unexpected token ' + c);
  };
  Parser.prototype.str = function () {
    var q = this.s[this.i], s = this.i; this.i++; var out = '';
    var escMap = { n:'\n', r:'\r', t:'\t', b:'\x08', f:'\x0c', v:'\x0b', '0':'\x00' };
    while (this.i < this.s.length) {
      var c = this.s[this.i++];
      if (c === '\\') {
        var n = this.s[this.i++];
        if (n === 'u') { var h = this.s.slice(this.i,this.i+4); if (/^[0-9a-fA-F]{4}$/.test(h)) { out += String.fromCharCode(parseInt(h,16)); this.i += 4; } else out += n; continue; }
        if (n === 'x') { var h2 = this.s.slice(this.i,this.i+2); if (/^[0-9a-fA-F]{2}$/.test(h2)) { out += String.fromCharCode(parseInt(h2,16)); this.i += 2; } else out += n; continue; }
        out += Object.prototype.hasOwnProperty.call(escMap,n) ? escMap[n] : n;
        continue;
      }
      if (c === q) break;
      out += c;
    }
    return { k:'str', v:out, s:s, e:this.i, quote:q };
  };
  Parser.prototype.obj = function () {
    var s = this.i; this.i++; var props = []; this.ws();
    if (this.s[this.i] === '}') { this.i++; return { k:'obj', props:props, s:s, e:this.i }; }
    for (;;) {
      this.ws(); var ks = this.i;
      var keyNode = (this.s[this.i]==='"'||this.s[this.i]==="'") ? this.str() : (function(p){ var m=/^[A-Za-z_$][\w$]*/.exec(p.s.slice(p.i)); if(!m) p.err('bad key'); p.i+=m[0].length; return {v:m[0]}; })(this);
      var key = keyNode.v;
      this.ws(); if (this.s[this.i] !== ':') this.err('expected :'); this.i++;
      var val = this.value();
      props.push({ key:key, val:val, s:ks, e:this.i, vs:val.s, ve:val.e });
      this.ws();
      if (this.s[this.i] === ',') { this.i++; this.ws(); if (this.s[this.i] === '}') { this.i++; break; } continue; }
      if (this.s[this.i] === '}') { this.i++; break; }
      this.err('expected , or }');
    }
    return { k:'obj', props:props, s:s, e:this.i };
  };
  Parser.prototype.arr = function () {
    var s = this.i; this.i++; var items = []; this.ws();
    if (this.s[this.i] === ']') { this.i++; return { k:'arr', items:items, s:s, e:this.i }; }
    for (;;) {
      items.push(this.value()); this.ws();
      if (this.s[this.i] === ',') { this.i++; this.ws(); if (this.s[this.i] === ']') { this.i++; break; } continue; }
      if (this.s[this.i] === ']') { this.i++; break; }
      this.err('expected , or ]');
    }
    return { k:'arr', items:items, s:s, e:this.i };
  };

  function prop(o,k) { if(!o||o.k!=='obj') return null; for(var i=0;i<o.props.length;i++) if(o.props[i].key===k) return o.props[i]; return null; }
  function numOf(o,k,d){ var p=prop(o,k); return p&&p.val.k==='num'?p.val.v:d; }
  function strOf(o,k,d){ var p=prop(o,k); return p&&p.val.k==='str'?p.val.v:d; }
  function dataOf(o){ var p=prop(o,'data'); if(!p) return null;
    if(p.val.k==='str') return { form:'str', list:p.val.v.split(/\s+/).filter(function(x){return x.length;}), range:[p.val.s,p.val.e] };
    if(p.val.k==='arr') return { form:'arr', list:p.val.items.map(function(x){return String(x.v);}), range:[p.val.s,p.val.e] };
    return null; }

  function parseWave(w, dataList) {
    var slots=[], subs=[], di=0, prev='x', pending='';
    for (var i=0;i<w.length;i++) {
      var c=w[i];
      if (c==='<'||c==='>') { pending+=c; continue; }
      if (pending) { subs.push({ at:slots.length, s:pending }); pending=''; }
      var rep = (c==='.'||c==='|');
      var point = !rep;
      var wv = point ? (rep?'x':c) : prev;
      var label = null;
      if (point && !rep && BUS.test(c)) label = (dataList && di<dataList.length) ? dataList[di++] : '';
      slots.push({ w:wv, point:point, gap:(c==='|'), label:label });
      prev = wv;
    }
    if (pending) subs.push({ at:slots.length, s:pending });
    return { slots:slots, subs:subs, consumed:di };
  }

  function normalizeSlots(l) {
    var prev='x';
    for (var i=0;i<l.slots.length;i++) {
      var s=l.slots[i];
      if (s.point && !s.gap) { prev=s.w; }
      else { s.w=prev; s.label=null; }
    }
  }

  // 行上**我们不建模**的属性（WaveJSON 里有 `over` / `under` 这类时间线标注，将来还可能有别的）
  // 必须原样留住。全量重生成（分组改名、增删行）会把整篇源码重排一遍 —— 不带走就等于删掉
  // 用户写的东西。做法与根级 `extras` 一致：存「key + 原文片段」，emit 时照样写回。
  var LANE_KEYS = { name:1, wave:1, data:1, node:1, phase:1, period:1 };
  function makeLane(item, groupPath, id, src) {
    var w=strOf(item,'wave',''), d=dataOf(item), nd=strOf(item,'node',null);
    // `wave: ['pw', { d: 'M…' }]` 是 WaveDrom 的 piece-wise 路径（不是字符序列）。
    // 我们没法把它拆成格子，但可以整段留住原文；用户真去改这一格的字符时再清掉
    // （那时语义已变成字符序列，保留原文只会让改动「看起来没生效」）。
    var waveNode=prop(item,'wave');
    var waveRaw=(waveNode && waveNode.val.k!=='str') ? src.slice(waveNode.val.s,waveNode.val.e) : null;
    var extras=[];
    item.props.forEach(function(p){ if(!LANE_KEYS[p.key]) extras.push({ key:p.key, text:src.slice(p.s,p.e) }); });
    var pw=parseWave(w, d?d.list:[]);
    var slots=pw.slots, n=slots.length;
    var node=[];
    // 只有 node、没有 wave 的行（教程 `{ node: '...g..h' }`）用它自己的 node 字符串定长，
    // 否则会因 slots 为空而丢掉锚点、引用它的 edge 找不到端点。有 slots 的行仍按 slots 定长
    // （保持既有行为与往返不变量：node 与 slots 一一对应）。
    var nn = n > 0 ? n : (nd ? nd.length : 0);
    for (var i=0;i<nn;i++) node.push(nd && i<nd.length ? nd[i] : '.');
    var lane = {
      // `hasName`：源码里**有没有** name 属性。上游对没有 name 的行不画行名（tutorial 的
      // `{ node: '...g..h' }` 就是空白行）；我们内部仍用 'sig' 兜底（编辑与写回都要有个值），
      // 只在**显示**时看这个标记。别拿 namePropRange 判断 —— 它只在 clone 里被复制，解析时并不赋值。
      hasName:!!prop(item,'name'),
      // 同理记录「源码里有没有 wave」：整行没有 wave（只有 node 的锚点行）在写回时也不该
      // 凭空补一个 `wave: ''` —— 那是纯粹的噪声，用户会以为编辑器动了他的源码。
      hasWave:!!prop(item,'wave'),
      id:id, kind:'signal', name:strOf(item,'name','sig'), phase:numOf(item,'phase',0), period:numOf(item,'period',1),
      groupPath:groupPath.slice(), slots:slots, subs:pw.subs, node:node,
      dataForm:d?d.form:null, range:[item.s,item.e], extras:extras, waveRaw:waveRaw,
      orig:{ wave:w, name:strOf(item,'name','sig'), data:d?d.list.slice():null, node:nd, phase:numOf(item,'phase',0), period:numOf(item,'period',1) }
    };
    ['wave','name','data','node','phase','period'].forEach(function(k){ var p=prop(item,k);
      lane[k+'Range'] = p?[p.val.s,p.val.e]:null; lane[k+'PropRange'] = p?[p.s,p.e]:null; });
    normalizeSlots(lane);
    return lane;
  }

  function collect(items, groupPath, out, src) {
    items.forEach(function(item) {
      if (item.k==='obj') {
        // WaveJSON 的空行就是**空对象 `{}`**（官方教程 Step 4「Spacers and Gaps」、Step 5 的组间
        // 间距都用它；没有 `{spacer: N}` 这种写法 —— wavedrom 3.5.0 的 lib 里根本没有 "spacer"
        // 这个字段）。上游 rec() 对**任何**对象都只算一行，parse 时只读 name/wave/data/node/
        // phase/period，其余属性一概不解释。所以判定口径跟着上游走：**没有 name、也没有 wave
        // 的对象就是一条空行**（`{spacer: 20}` 里那个 20 上游同样忽略，它也只占一行）。
        // 原文必须留住：改分组会整篇重生成源码，不能把用户写的 `{ spacer: 20 }` 悄悄改成 `{}`。
        // node / data 也要排除：`{ node: '...g..h' }` 这种「只有锚点没有 wave」的行是
        // 本项目明确支持的（教程 Sharp lines 用 edge 引用它的端点），不能当成空行吃掉。
        if (!prop(item,'name') && !prop(item,'wave') && !prop(item,'node') && !prop(item,'data')) {
          out.push({ id:'l'+out.length, kind:'spacer', name:'', groupPath:groupPath.slice(),
                     slots:[], subs:[], node:[], range:[item.s,item.e],
                     raw:src.slice(item.s,item.e), orig:{} });
          return;
        }
        out.push(makeLane(item, groupPath, 'l'+out.length, src));
      } else if (item.k==='arr') {
        // 组名可以是字符串也可以是数字（上游 rec() 认 `typeof tmp[0] === 'number'`）：
        // `[1, {…}]` 是合法 WaveJSON，别把它读成「没有名字的组」。
        var h=item.items[0];
        var g = (h && (h.k==='str'||h.k==='num')) ? String(h.v) : '';
        collect(item.items.slice(1), groupPath.concat([g]), out, src);
      }
    });
  }

  function buildIR(src) {
    var p=new Parser(src); p.ws();
    var wrapped=false;
    if (p.s[p.i]==='(') { p.i++; wrapped=true; }
    var root=p.value();
    if (root.k!=='obj') throw new Error('root must be an object');
    p.ws();
    if (wrapped) { if (p.s[p.i]!==')') throw new Error('missing closing parenthesis'); p.i++; p.ws(); }
    if (p.i < p.s.length) throw new Error('unexpected content after the root object @'+p.i);
    var sig=prop(root,'signal');
    // 报错要指向**用户下一步该做什么**：「缺少 signal 数组」对着一份 `{reg: …}` 文档等于没说。
    // reg 是 WaveJSON 的另一种图（寄存器位域），不是时序图的坏写法 —— 直接说清楚。
    if(!sig){
      if(prop(root,'reg')) throw new Error('this is a register diagram (reg), TimingBench edits timing diagrams (signal)');
      throw new Error('missing signal array');
    }
    if(sig.val.k!=='arr') throw new Error('signal must be an array');
    var lanes=[];
    collect(sig.val.items, [], lanes, src);
    var N=0; lanes.forEach(function(l){ if(l.kind==='signal'){ N=Math.max(N,l.slots.length); normalizeSlots(l); } });
    var edges=[], extras=[], config=null;
    root.props.forEach(function(pr){
      if(pr.key==='signal') return;
      if(pr.key==='edge' && pr.val.k==='arr'){ edges=pr.val.items.map(function(x){return String(x.v);}); return; }
      // config 既要能读（hscale 要影响渲染），又要能原样写回（不归我们管的键一个都不能丢）：
      // 原文进 extras，解释后的值另存一份只读副本。
      if(pr.key==='config' && pr.val.k==='obj') config=materialize(pr.val);
      extras.push({ key:pr.key, text:src.slice(pr.s,pr.e), range:[pr.s,pr.e] });
    });
    return { ticks:N, lanes:lanes, edges:edges, extras:extras, config:config, raw:src, rootRange:[root.s,root.e], rev:0 };
  }

  function quote(s,q){ q=q||"'"; return q+String(s).replace(/\\/g,'\\\\').replace(new RegExp(q,'g'),'\\'+q)
    .replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t')
    .replace(/\x08/g,'\\b').replace(/\x0c/g,'\\f').replace(/\x0b/g,'\\v').replace(/\x00/g,'\\0')+q; }
  function qmap(a){ return a.map(function(x){return quote(x);}).join(', '); }
  function subsAt(l,at){ var s=''; l.subs.forEach(function(x){ if(x.at===at) s+=x.s; }); return s; }
  function laneWave(l){
    var out='';
    for(var i=0;i<l.slots.length;i++){
      out+=subsAt(l,i);
      var s=l.slots[i];
      if(s.gap) out+='|'; else if(!s.point) out+='.'; else out+=s.w;
    }
    return out+subsAt(l,l.slots.length);
  }
  function laneLabels(l){ return l.slots.filter(function(s){return s.point&&!s.gap&&BUS.test(s.w)&&s.label!==null;}).map(function(s){return s.label;}); }
  function needData(l){ var a=laneLabels(l); return a.length>0 && (l.dataForm!==null || a.some(function(x){return x!=='';})); }

  // 空行照**源码原文**写回（`{ spacer: 20 }` 就写回 `{ spacer: 20 }`）；新建的空行没有原文 → `{}`。
  function spacerSrc(l){ return l.raw||'{}'; }
  function emitLane(l){
    if(l.kind==='spacer') return spacerSrc(l);
    var labels=laneLabels(l), parts=[];
    // 源码里本来没有 name 的行（只有 node 的锚点行）不补 name —— 补了它就从「空白行」变成
    // 「叫 sig 的行」，与上游的样子也不一致。用户真改了名字（与兜底值不同）时照常写。
    if(l.hasName!==false || l.name!==(l.orig&&l.orig.name)) parts.push('name: '+quote(l.name));
    // piece-wise 路径（数组 wave）整段原样写回，别用 slots 重建 —— 那一行本来就没有 slots。
    // 整行没有 wave、也没有任何格子（锚点行）时不写 `wave: ''`，那是没来由的噪声。
    if(l.waveRaw || l.slots.length || l.hasWave) parts.push('wave: '+(l.waveRaw||quote(laneWave(l))));
    if(needData(l)) parts.push('data: '+(l.dataForm==='str'&&labels.every(function(x){return x&&!/\s/.test(x);}) ? quote(labels.join(' ')) : '['+qmap(labels)+']'));
    if(l.node.some(function(x){return x!=='.';})) parts.push('node: '+quote(l.node.join('')));
    if(l.phase) parts.push('phase: '+l.phase);
    if(l.period!==1) parts.push('period: '+l.period);
    // 未建模属性（over / under / …）照原文追加在末尾
    (l.extras||[]).forEach(function(x){ parts.push(x.text); });
    return '{ '+parts.join(', ')+' }';
  }
  function emitGroup(items,depth){
    var out=[], i=0;
    while(i<items.length){
      var l=items[i];
      if(l.kind==='spacer'){ out.push(spacerSrc(l)); i++; continue; }
      if(l.groupPath.length>depth){
        var g=l.groupPath[depth], sub=[];
        while(i<items.length && items[i].groupPath.length>depth && items[i].groupPath[depth]===g){ sub.push(items[i]); i++; }
        out.push('['+quote(g)+', '+emitGroup(sub,depth+1).join(', ')+']');
      } else { out.push(emitLane(l)); i++; }
    }
    return out;
  }
  function emitIR(ir){
    var body=emitGroup(ir.lanes,0).map(function(s){return '  '+s;}).join(',\n');
    var tail='';
    if(ir.edges.length) tail+=',\n  edge: ['+qmap(ir.edges)+']';
    ir.extras.forEach(function(x){ tail+=',\n  '+x.text; });
    return '{ signal: [\n'+body+'\n]'+tail+'\n}';
  }

  function enc(s){ s=String(s); return s.length+':'+s+';'; }
  function canon(ir){
    var parts=[];
    ir.lanes.forEach(function(l){
      if(l.kind==='spacer'){ parts.push(enc('~'+enc(l.groupPath.join('/'))+enc(spacerSrc(l)))); return; }
      var ss=l.slots.map(function(s){ return enc(s.w)+enc(s.point?'P':'r')+enc(s.gap?'G':'-')+enc(s.label===null?'':s.label); }).join('');
      // extras / waveRaw 参与签名：它们也是「这一行的语义」，只在源码里存在而在 canon 外，
      // 会让「改了 over 但源码相等」这类偏差悄悄通过 I2 检查。
      parts.push(enc(enc(l.name)+enc(String(l.phase))+enc(String(l.period))+enc(l.groupPath.join('/'))+enc(l.node.join(''))+enc(l.waveRaw||laneWave(l))+enc(ss)+enc((l.extras||[]).map(function(x){return x.text;}).join(''))));
    });
    parts.push(enc('E'+ir.edges.map(enc).join('')));
    return parts.join('');
  }

  function clone(ir){
    return { ticks:ir.ticks, rev:ir.rev, raw:ir.raw, rootRange:ir.rootRange.slice(), config:ir.config?JSON.parse(JSON.stringify(ir.config)):null,
      edges:ir.edges.slice(), extras:ir.extras.map(function(x){return {key:x.key,text:x.text,range:x.range.slice()};}),
      lanes:ir.lanes.map(function(l){
        return { id:l.id, kind:l.kind, hasName:l.hasName!==false, hasWave:l.hasWave!==false, name:l.name, phase:l.phase, period:l.period, groupPath:l.groupPath.slice(),
          slots:l.slots.map(function(s){ var o={w:s.w,point:s.point,gap:s.gap,label:s.label};
            if(s.saved) o.saved={w:s.saved.w,label:s.saved.label}; return o; }),
          subs:l.subs.map(function(s){return {at:s.at,s:s.s};}), node:l.node.slice(), dataForm:l.dataForm,
          range:l.range.slice(), raw:l.raw, extras:(l.extras||[]).map(function(x){return {key:x.key,text:x.text};}), waveRaw:l.waveRaw||null,
          waveRange:l.waveRange?l.waveRange.slice():null, nameRange:l.nameRange?l.nameRange.slice():null,
          dataRange:l.dataRange?l.dataRange.slice():null, nodeRange:l.nodeRange?l.nodeRange.slice():null,
          phaseRange:l.phaseRange?l.phaseRange.slice():null, periodRange:l.periodRange?l.periodRange.slice():null,
          wavePropRange:l.wavePropRange?l.wavePropRange.slice():null, namePropRange:l.namePropRange?l.namePropRange.slice():null,
          dataPropRange:l.dataPropRange?l.dataPropRange.slice():null, nodePropRange:l.nodePropRange?l.nodePropRange.slice():null,
          phasePropRange:l.phasePropRange?l.phasePropRange.slice():null, periodPropRange:l.periodPropRange?l.periodPropRange.slice():null,
          orig:{ wave:l.orig.wave, name:l.orig.name, data:l.orig.data?l.orig.data.slice():null, node:l.orig.node, phase:l.orig.phase, period:l.orig.period } };
      }) };
  }

  function labelList(v){
    if(Array.isArray(v)) return v.map(function(x){return String(x);});
    var s=String(v===undefined||v===null?'':v).trim();
    return s?s.split(/\s+/):[];
  }
  function retick(n){
    var t=0; n.lanes.forEach(function(l){ if(l.kind==='signal') t=Math.max(t,l.slots.length); }); n.ticks=t;
  }
  function nextLaneId(n){
    var used={}, i=0; n.lanes.forEach(function(l){ used[l.id]=1; });
    while(used['l'+i]) i++;
    return 'l'+i;
  }
  // 尾部续写：wave 比全局周期数短时，先按 repeater 语义补齐到目标周期再落笔；
  // 只在确实扩展时返回 true，避免影响原本范围内的写入。
  function ensureTail(l,tick){
    if(l.kind!=='signal'||l.slots.length>tick) return false;
    var last=l.slots.length?l.slots[l.slots.length-1].w:'x';
    while(l.slots.length<=tick){ l.slots.push({w:last,point:false,gap:false,label:null}); l.node.push('.'); }
    return true;
  }

  // 一旦按字符改了这一行，piece-wise 路径就作废了：继续保留 waveRaw 会让 emit 写回旧路径，
  // 用户的改动「看起来没生效」。反之只要没人碰字符，原文就一直留着。
  function unraw(l){ if(l&&l.waveRaw) l.waveRaw=null; }
  function applyOp(ir,op){
    var n=clone(ir), changed=true;
    switch(op.t){
      case 'setSlot': {
        var ext=false;
        n.lanes.forEach(function(l){ if(l.kind!=='signal'||(op.lanes&&op.lanes.indexOf(l.id)<0)) return;
          unraw(l);
          if(ensureTail(l,op.tick)) ext=true;
          var v=op.v; if(v==='auto'){ var cur=l.slots[op.tick].w; v=ALL[(ALL.indexOf(cur)+1+ALL.length)%ALL.length]||'1'; }
          l.slots[op.tick]={ w:v, point:true, gap:false, label:BUS.test(v)?'':null }; normalizeSlots(l); });
        if(ext) retick(n);
        break;
      }
      case 'setLabel':
        n.lanes.forEach(function(l){ if(l.id===op.lane&&op.tick<l.slots.length){ var s=l.slots[op.tick]; if(s.point&&!s.gap&&BUS.test(s.w)) s.label=op.v; } });
        break;
      case 'setNode':
        n.lanes.forEach(function(l){ if(l.id===op.lane&&op.tick<l.slots.length) l.node[op.tick]=op.v||'.'; });
        break;
      case 'rename':
        n.lanes.forEach(function(l){ if(l.id===op.lane) l.name=String(op.v); });
        break;
      case 'setWave':
        n.lanes.forEach(function(l){
          if(l.id!==op.lane||l.kind!=='signal') return;
          unraw(l);
          var pw=parseWave(String(op.v||''), laneLabels(l)), oldNode=l.node.slice();
          l.slots=pw.slots; l.subs=pw.subs; l.node=[];
          for(var wi=0;wi<l.slots.length;wi++) l.node.push(wi<oldNode.length?oldNode[wi]:'.');
          normalizeSlots(l);
        });
        retick(n);
        break;
      case 'setLabels':
        n.lanes.forEach(function(l){
          if(l.id!==op.lane||l.kind!=='signal') return;
          var list=labelList(op.v), k=0;
          // bus 点的 label 必须全为字符串：混入 null 会让 emit 的 data 数组与 marker 顺序错位
          if(!list.length) l.dataForm=null;
          l.slots.forEach(function(s){
            if(s.point&&!s.gap&&BUS.test(s.w)) s.label=k<list.length?list[k++]:'';
            else s.label=null;
          });
        });
        break;
      case 'setNodeStr':
        n.lanes.forEach(function(l){
          if(l.id!==op.lane||l.kind!=='signal') return;
          var s=String(op.v||''), out=[];
          for(var ni=0;ni<l.slots.length;ni++) out.push(ni<s.length?s[ni]:'.');
          l.node=out;
        });
        break;
      case 'moveLane': {
        // 两种目标写法：`v:'up'|'down'`（上下文条一步）与 `to:索引`（拖拽到任意位置）。
        // 拖拽用 splice 挪动而不是两两交换 —— Obsidian 1.5.2 起也是「移动」而非「交换」，
        // 交换在跨多行时会把中间行整体推错位。
        var mi=-1; n.lanes.forEach(function(l,i){ if(l.id===op.lane) mi=i; });
        if(mi<0) break;
        var mj=(op.to!==undefined&&op.to!==null)
          ? Math.max(0,Math.min(n.lanes.length-1,op.to))
          : mi+(op.v==='up'?-1:1);
        if(mj>=0&&mj<n.lanes.length&&mj!==mi){
          var mmoved=n.lanes.splice(mi,1)[0];
          n.lanes.splice(mj,0,mmoved);
          rehomeAfterMove(n.lanes, op.lane);
        }
        break;
      }
      // 整列移动：每一行的第 from 个槽位移到 to。槽位带着字符 / 数据标签 / 断点标志一起走，
      // node 锚点串与 sub-cycle 包的下标同步重映射；continuation 槽的 `w` 由 normalizeSlots 重算。
      case 'moveTick': {
        var mf=op.from, mt=op.to;
        if(mf===mt||mf<0) break;
        n.lanes.forEach(function(l){
          if(l.kind!=='signal') return;
          unraw(l);
          if(mf>=l.slots.length) return;
          var mslot=l.slots.splice(mf,1)[0];
          var mnode=l.node.splice(mf,1)[0];
          var mat=Math.max(0,Math.min(mt,l.slots.length));
          l.slots.splice(mat,0,mslot);
          l.node.splice(mat,0,mnode===undefined?'.':mnode);
          l.subs.forEach(function(s){
            if(s.at===mf) s.at=mat;
            else if(mf<mat&&s.at>mf&&s.at<=mat) s.at--;
            else if(mf>mat&&s.at>=mat&&s.at<mf) s.at++;
          });
          normalizeSlots(l);
        });
        break;
      }
      case 'setPhase': case 'setPeriod':
        n.lanes.forEach(function(l){ if(l.id===op.lane) l[op.t==='setPhase'?'phase':'period']=op.v; });
        break;
      case 'setEdges': n.edges=op.v.slice(); break;
      case 'toggleGap':
        n.lanes.forEach(function(l){ if(l.kind!=='signal'||op.tick>=l.slots.length) return;
          var s=l.slots[op.tick];
          if(s.gap){
            if(s.saved){ s.point=true; s.gap=false; s.w=s.saved.w; s.label=s.saved.label; delete s.saved; }
            else s.gap=false;
          } else {
            if(s.point) s.saved={w:s.w,label:s.label};
            s.gap=true; s.point=false; s.label=null;
          }
          normalizeSlots(l); });
        break;
      case 'insertTick':
        n.lanes.forEach(function(l){ if(l.kind!=='signal') return;
          unraw(l);
          var at=Math.min(op.tick,l.slots.length), prev=at>0?l.slots[at-1].w:'x';
          l.slots.splice(at,0,{w:prev,point:false,gap:false,label:null}); l.node.splice(at,0,'.');
          l.subs.forEach(function(s){ if(s.at>=at) s.at++; }); normalizeSlots(l); });
        n.ticks++;
        break;
      case 'deleteTick':
        if(n.ticks<=1){ changed=false; break; }
        n.lanes.forEach(function(l){ if(l.kind!=='signal'||op.tick>=l.slots.length) return;
          unraw(l);
          l.slots.splice(op.tick,1); l.node.splice(op.tick,1);
          l.subs.forEach(function(s){ if(s.at>op.tick) s.at--; }); normalizeSlots(l); });
        n.ticks--;
        break;
      case 'addLane': {
        var aid=op.id||nextLaneId(n);
        var aat=(op.at===undefined?n.lanes.length:Math.max(0,Math.min(n.lanes.length,op.at)));
        var fresh;
        if(op.kind==='spacer'){
          fresh={ id:aid, kind:'spacer', name:'', phase:0, period:1, groupPath:[], slots:[], subs:[], node:[], dataForm:null,
            range:[0,0], raw:'', extras:[], waveRaw:null, orig:{}, fresh:true };
        } else {
          fresh={ id:aid, kind:'signal', hasName:true, hasWave:true, name:op.name||'new', phase:0, period:1, groupPath:[], slots:[], subs:[], node:[], dataForm:null,
            range:[0,0], extras:[], waveRaw:null, waveRange:null, nameRange:null, dataRange:null, nodeRange:null, phaseRange:null, periodRange:null,
            wavePropRange:null, namePropRange:null, dataPropRange:null, nodePropRange:null, phasePropRange:null, periodPropRange:null,
            orig:{wave:'',name:op.name||'new',data:null,node:null,phase:0,period:1}, fresh:true };
          for(var ai=0;ai<n.ticks;ai++){ fresh.slots.push({w:'x',point:ai===0,gap:false,label:null}); fresh.node.push('.'); }
          normalizeSlots(fresh);
        }
        n.lanes.splice(aat,0,fresh);
        break;
      }
      case 'deleteLane': n.lanes=n.lanes.filter(function(l){return l.id!==op.lane;}); break;
      // 分组改名 / 重分组。两种定址方式，语义都是「把这些行的 groupPath 设成 path」：
      //   · 传 lanes（行 id 数组）—— 行上下文条的「组」动作 / 范围归组用这条；
      //   · 传 old（旧路径字符串）—— 点组名改整组用这条，含 spacer，整组一起改。
      // 空路径 = 取消分组。分组结构变化无法用字面量补丁表达，patchSource 会回落全量 emit。
      case 'regroup': {
        var oldKey=String(op.old||'');
        var ids=op.lanes||null;
        var depth=oldKey?oldKey.split('/').length:0;
        n.lanes.forEach(function(l){
          if(ids){ if(ids.indexOf(l.id)>=0) l.groupPath=(op.path||[]).slice(); return; }
          // `old` 按**路径前缀**匹配，不是等值匹配：外层括号（如 `out`）自己没有行
          // （行都在 `out/in` 里），等值匹配会「点了没反应」；前缀匹配同时覆盖叶子组
          // （完全相等也是自己的前缀）与「改名后子树一起跟过去」。
          var k=l.groupPath.join('/');
          if(k===oldKey || (oldKey && k.indexOf(oldKey+'/')===0)){
            l.groupPath=(op.path||[]).concat(l.groupPath.slice(depth));
          }
        });
        break;
      }
      default: changed=false;
    }
    if(changed){ n.rev++; }
    return n;
  }

  // 行被移动之后重新判定它的分组归属 —— 组是「连续行」的概念，一旦不再连续就会渲染成
  // 两个同名括号（实测：组内末行下移一格就变成两段 ['bus', …], {c}, ['bus', …]）。
  // 规则（只在移动后对**被移动的那一行**生效，不碰别人）：
  //   ① 上下邻居里还有同路径的 → 它仍在自己的组里，不动；
  //   ② 上下邻居同属一个（非空）组、而它自己不在 → 它被插到组中间，入组，组保持完整；
  //   ③ 否则从深到浅找一个「上下邻居至少有一行的路径前缀能对上」的层，落到那一层；
  //      一层都找不到就退成无组（不制造「只有自己一段」的幽灵组）。
  function rehomeAfterMove(lanes, id){
    var i=-1; for(var k=0;k<lanes.length;k++){ if(lanes[k].id===id){ i=k; break; } }
    if(i<0) return;
    var self=lanes[i], path=self.groupPath;
    var above=i>0?lanes[i-1]:null, below=i+1<lanes.length?lanes[i+1]:null;
    function key(l){ return l?l.groupPath.join('/'):null; }
    if(path.length && (key(above)===key(self) || key(below)===key(self))) return;
    if(above && below && above.groupPath.length &&
       key(above)===key(below) && above.kind===self.kind){
      self.groupPath=above.groupPath.slice(); return;
    }
    for(var d=path.length-1; d>=1; d--){
      var pref=path.slice(0,d).join('/');
      var up=above&&above.groupPath.slice(0,d).join('/')===pref;
      var dn=below&&below.groupPath.slice(0,d).join('/')===pref;
      if(up||dn){ self.groupPath=path.slice(0,d); return; }
    }
    self.groupPath=[];
  }

  function slotsEqual(a,b){
    if(a.length!==b.length) return false;
    for(var i=0;i<a.length;i++){ var x=a[i],y=b[i]; if(x.w!==y.w||x.point!==y.point||x.gap!==y.gap||x.label!==y.label) return false; }
    return true;
  }
  function subsSig(l){ return l.subs.map(function(s){return s.at+':'+s.s;}).join(','); }
  // 在对象末尾追加字段：复用已有的尾逗号，避免生成 " , , key: ..." 这类非法源码
  function fieldInsert(range,src,texts){
    var i=range[1]-1, body=texts.join(', ');
    while(i>range[0] && /\s/.test(src[i-1])) i--;
    if(i>range[0] && src[i-1]===',') return { s:i-1, e:i, txt:', '+body+',' };
    return { s:i, e:i, txt:', '+body+' ' };
  }
  // 删除整个属性（含分隔逗号），用于不再需要 data 字段时
  function fieldDelete(propRange,src){
    var st=propRange[0], en=propRange[1], j=st;
    while(j>0 && /\s/.test(src[j-1])) j--;
    if(src[j-1]===',') st=j-1;
    else { var k=en; while(k<src.length && /\s/.test(src[k])) k++; if(src[k]===',') en=k+1; }
    return { s:st, e:en, txt:'' };
  }

  function patchSource(ir,newIR){
    var src=ir.raw, edits=[], fallback=false;
    // 行集合 / 顺序 / 分组结构变化无法用字面量补丁表达，必须走全量 emit
    if(ir.lanes.map(function(l){return l.id;}).join('|')!==newIR.lanes.map(function(l){return l.id;}).join('|')) fallback=true;
    if(ir.lanes.length===newIR.lanes.length) ir.lanes.forEach(function(ol,i){
      if(newIR.lanes[i] && ol.groupPath.join('/')!==newIR.lanes[i].groupPath.join('/')) fallback=true;
    });
    newIR.lanes.forEach(function(nl){
      var ol=null; ir.lanes.forEach(function(l){ if(l.id===nl.id) ol=l; });
      if(!ol){ fallback=true; return; }
      if(nl.fresh){ fallback=true; return; }
      if(nl.kind==='spacer'||ol.kind==='spacer') return;
      var waveChanged = !slotsEqual(ol.slots,nl.slots) || subsSig(ol)!==subsSig(nl);
      if(waveChanged){ if(!nl.waveRange){ fallback=true; return; } edits.push({s:nl.waveRange[0],e:nl.waveRange[1],txt:quote(laneWave(nl),src[nl.waveRange[0]])}); }
      if(nl.name!==ol.orig.name){ if(!nl.nameRange){ fallback=true; return; } edits.push({s:nl.nameRange[0],e:nl.nameRange[1],txt:quote(nl.name,src[nl.nameRange[0]])}); }
      var adds=[];
      var oldLabels=ol.orig.data||[], newLabels=laneLabels(nl), effective=oldLabels.slice(0,laneLabels(ol).length);
      var need = needData(nl), oldNeed = ol.dataRange!==null && effective.length>0;
      var dataChanged = (need||oldNeed) && (effective.join('\u0001')!==newLabels.join('\u0001') || need!==oldNeed);
      if(dataChanged){
        var q0 = nl.dataRange?src[nl.dataRange[0]]:(nl.waveRange?src[nl.waveRange[0]]:"'");
        var txt = (nl.dataForm==='str'&&newLabels.length&&newLabels.every(function(x){return x&&!/\s/.test(x);})) ? quote(newLabels.join(' '),q0) : '['+qmap(newLabels)+']';
        if(!need){
          // 字段不再需要：删除整个属性，而不是写 data:null（标签按空格分词，null 会抛错）
          if(nl.dataPropRange) edits.push(fieldDelete(nl.dataPropRange,src));
          else if(nl.dataRange) fallback=true;
        }
        else if(nl.dataRange) edits.push({s:nl.dataRange[0],e:nl.dataRange[1],txt:txt});
        else adds.push('data: '+txt);
      }
      var nodeStr=nl.node.join(''), oldNode=ol.orig.node||'';
      if(nodeStr.replace(/\.+$/,'')!==oldNode.replace(/\.+$/,'')){
        if(nl.nodeRange) edits.push({s:nl.nodeRange[0],e:nl.nodeRange[1],txt:quote(nodeStr,src[nl.nodeRange[0]])});
        else adds.push('node: '+quote(nodeStr));
      }
      [['phase','phaseRange'],['period','periodRange']].forEach(function(pair){
        var k=pair[0], r=pair[1], def=k==='phase'?0:1;
        if(nl[k]===ol.orig[k]) return;
        if(nl[r]) edits.push({s:nl[r][0],e:nl[r][1],txt:String(nl[k])});
        else if(nl[k]!==def) adds.push(k+': '+nl[k]);
      });
      if(adds.length){
        if(!nl.range || nl.range[1]<=nl.range[0]) fallback=true;
        else edits.push(fieldInsert(nl.range,src,adds));
      }
    });
    if(ir.edges.map(enc).join('')!==newIR.edges.map(enc).join('')) fallback=true;
    if(fallback) return { src:emitIR(newIR), patched:false, ratio:0, edits:0 };
    var mark={}, ok=true;
    edits.forEach(function(e){ for(var i=e.s;i<e.e;i++){ if(mark[i]) ok=false; mark[i]=1; } });
    if(!ok) return { src:emitIR(newIR), patched:false, ratio:0, edits:0 };
    edits.sort(function(a,b){return b.s-a.s;});
    var out=src, replaced=0;
    edits.forEach(function(e){ out=out.slice(0,e.s)+e.txt+out.slice(e.e); replaced+=(e.e-e.s); });
    var untouched=src.length-replaced;
    return { src:out, patched:true, ratio:out.length?Math.max(0,Math.min(1,untouched/out.length)):1, edits:edits.length };
  }

  function materialize(n){
    if(n.k==='obj'){ var o={}; n.props.forEach(function(p){o[p.key]=materialize(p.val);}); return o; }
    if(n.k==='arr') return n.items.map(materialize);
    return n.v;
  }
  function parseObject(src){ var p=new Parser(src); p.ws(); if(p.s[p.i]==='(') p.i++; return materialize(p.value()); }

  // 把「压缩成单行」的源码排成多行易读格式；原本就分行 / 带注释的源码原样返回。
  // 为什么只处理单行：emitIR 从 IR 重建源码，会丢掉注释与用户手写排版；对已经有自己
  // 格式的源码做这件事是破坏性的。而 data-wavejson / URL 片段塞进来的都是压缩单行，
  // 没有注释可丢 —— 这类正是「切到代码视图挤成一行」的来源，安全地格式化它们即可。
  // 解析失败也原样返回：格式化是显示层的事，绝不能因为格式化报错就挡住编辑。
  function formatSource(src){
    src = String(src == null ? '' : src);
    // 已有换行或含注释 → 视作用户排版，不碰。// 与 /* 都要挡（字符串里的 // 极少见，
    // 且即便误判也只是「不格式化」，不会损坏内容）。
    var body = src.replace(/^\s+|\s+$/g, '');
    if (body.indexOf('\n') >= 0 || body.indexOf('\r') >= 0 || body.indexOf('//') >= 0 || body.indexOf('/*') >= 0) return src;
    var ir;
    try { ir = buildIR(src); }
    catch (e) { return src; }
    try {
      var out = emitIR(ir);
      // 语义兜底：格式化结果必须与原 IR 等价，否则不采用（防御 emitIR 未来的任何偏差）。
      return canon(buildIR(out)) === canon(ir) ? out : src;
    } catch (e) { return src; }
  }

  return { buildIR:buildIR, emitIR:emitIR, canon:canon, applyOp:applyOp, patchSource:patchSource, clone:clone,
    laneWave:laneWave, laneLabels:laneLabels, quote:quote, enc:enc, parseObject:parseObject, normalizeSlots:normalizeSlots,
    formatSource:formatSource, BUS:BUS, LEVEL:LEVEL, CLOCK:CLOCK, ALL:ALL };
})();
