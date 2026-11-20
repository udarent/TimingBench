// 单周期波形图元：参考上游默认皮肤的外观规范自行绘制（实线 / 斜线阴影 / 虚线 /
// 箭头 / 总线配色）。纯函数，主画布与候选字符条共用；无状态、无 DOM。
import { Core } from '../core/ir.js';
import { G } from './geometry.js';
import { esc } from '../core/util.js';

var CHIP_W=G.CHIP_W;
  var BUS_CLASS={'=':'bus2','2':'bus2','3':'bus3','4':'bus4','5':'bus5','6':'bus6','7':'bus7','8':'bus8','9':'bus9'};
  function waveLevel(ch,T,M,B){
    if(/[1hHu]/.test(ch)) return T;
    if(/[0lLd]/.test(ch)) return B;
    if(Core.BUS.test(ch)||Core.CLOCK.test(ch)||ch==='x') return null;
    return M;
  }
  // 斜线填充。`left` / `right` 是块体在该侧的可选边界线（[x0,y0,x1,y1]，也可以给一组）：
  // 填线要停在边界以内，否则会戳进过渡让出来的三角空缺里 —— 上游也是逐条线算交点裁的
  // （`0mx` / `xm0` 的每条 `s2` 端点都正好落在斜边上）。竖边（x0===x1）当作普通 x 截断；
  // 给一组时取**最近**的那条（收口是「>」形的两条边，填线该停在哪条取决于它从哪半边过来）。
  function waveHatch(X,x1,T,B,W,left,right){
    var o=[], dy=B-T;
    // 步距：按格宽 W/7 取，但**不许**超过带宽的 1/3。上游的砖宽恒为 20px、带宽 20，
    // 于是它的斜线间隔恒为 5px（每砖 4 条）—— 与带宽绑定，不随 hscale 变稀。我们若只按 W 取，
    // hscale 4 时间隔会到 21px，过渡的收口楔形（只有 6px 宽）里一条线都落不进去，看上去就是一块白。
    // 取 1/3 而不是 1/6：带宽改由格宽决定后（20px），1/6 会退到 3.2px，比上游密一倍。
    // 再把步距**量化成 W 的整数分之一**：相邻格各按自己的格线起算斜线，W 不是步距的整数倍
    // 时，跨格会错位出半条线，同一条总线走到格线上会出现一道错缝。
    var want=Math.max(3,Math.min(W/7,dy/3)), nz=Math.max(1,Math.round(W/want)), step=W/nz, k, sx, a, b;
    // 交点：填线是 45°（y = sx+B-x），与边界线（x0,y0)-(x1,y1) 求交，解一次一元方程。
    var crossX=function(seg,sx){
      var vx=seg[2]-seg[0], vy=seg[3]-seg[1];
      if(!vy) return null;                       // 水平边界不动 x
      var kk=vx/vy, den=1+kk;
      if(Math.abs(den)<1e-6) return null;
      return (seg[0]+kk*((sx+B)-seg[1]))/den;
    };
    var bound=function(segs,sx,takeMin){
      if(!segs) return null;
      var list=(segs[0]!==undefined&&typeof segs[0]==='number')?[segs]:segs, r=null, i, v;
      for(i=0;i<list.length;i++){
        v=crossX(list[i],sx); if(v===null) continue;
        r=(r===null)?v:(takeMin?Math.min(r,v):Math.max(r,v));
      }
      return r;
    };
    // 起止由几何定，不写死条数：步距变小（宽格 / 高行）时条数要跟着变多，否则右半边会空着。
    var k0=Math.floor(-dy/step)-1, k1=Math.ceil((x1-X)/step)+1;
    for(k=k0;k<=k1;k++){
      sx=X+k*step; a=Math.max(X,sx); b=Math.min(x1,sx+dy);
      if(b<=a) continue;
      var cl=bound(left,sx,false), cr=bound(right,sx,true);
      if(cl!==null&&cl>a) a=cl;
      if(cr!==null&&cr<b) b=cr;
      if(b<=a+0.5) continue;
      o.push('<path class="waveHair" d="M'+a+','+(B-(a-sx))+' L'+b+','+(B-(b-sx))+'"/>');
    }
    return o.join('');
  }
  function waveArrow(ax,T,B,up){
    var y0=up?(T+3):(B-3), y1=up?(T+11):(B-11);
    return '<path class="waveArrow" d="M'+(ax-3)+','+y1+' L'+ax+','+y0+' L'+(ax+3)+','+y1+' Q'+ax+','+(y1-2)+' '+(ax-3)+','+y1+' z"/>';
  }
  // 某个字符画完之后停在**哪条轨**上：T / B；判不出电平的（x / z / 总线）返回 null。
  // 时钟字符要据此决定「边界处那条起沿还画不画」—— 上游用一张 xclude 表
  // （hp / Hp / ln / Ln / nh / Nh / pl / Pl 把首个 half-brick 换成纯电平）抑制多余边沿，
  // 否则 `h` 后面接 `p` 会在边界处多出一条横穿整行的竖线（Step 2 的 clk2 = hpHplnLn 最明显）。
  function railEnd(ch,T,B){
    if(!ch) return null;
    if(/[pPlL]/.test(ch)) return B;      // p / P 收在低；l / L 本身就是低
    if(/[nNhH]/.test(ch)) return T;      // n / N 收在高；h / H 本身就是高
    return waveLevel(ch,T,null,B);       // 1 / 0 / u / d；M 传 null ⇒ 判不出的字符返回 null
  }
  // 某个字符**从哪条轨起步**：与 railEnd 恰好相对。总线的收口要落在本格起步的那条轨上，
  // 所以这里不能用 railEnd —— `p` 收在低、却是从高起的，混用会让斜边朝反方向走。
  function railStart(ch,T,B){
    if(!ch) return null;
    if(/[pPhH]/.test(ch)) return T;      // p / P 从高起；h / H 是抬到高
    if(/[nNlL]/.test(ch)) return B;      // n / N 从低起；l / L 是落到低
    return waveLevel(ch,T,null,B);
  }
  // 收口尖「>」的两条斜边：从竖带两端收到中高度的尖上。它同时是斜线填充的右边界 ——
  // 换块时上一段要收成这个尖，下一段再从对面收过来，两段在尖上对触（上游 vmv / vmx-brick）。
  function capEdges(X,bi,bm,T,M,B){
    return [[X+bi,T,X+bm,M],[X+bi,B,X+bm,M]];
  }
  // 块体两端相对格线的偏移（上游 20px 砖里的 3..9，窄格按比例收）：起点 bi、落点 br、
  // 两段对尖的中线 bm。绘制、收口、标签居中三处共用这一份 —— 分开算迟早会有一处对不上。
  function blockEdge(W){
    var bi=Math.min(3,W*0.12), br=Math.min(9,W*0.34);
    return {bi:bi, br:br, bm:(bi+br)/2};
  }
  // 上一格是**块体**（总线或 x）、本格是电平：把块体那半块的收口画在**本格开头**的头 3..9px
  // （上游 vm-brick / xm-brick）。总线收口是实心色块、x 收口是斜线填充 —— 形态一样，只是「填什么」
  // 不同，所以共用一份几何。本格自己的电平线照常从格线铺满：过渡压在线下方向内收。
  function blockCap(ch,capCls,X,T,M,B,W,bi,br,bm){
    // 收口 = 「上一格的块体在本格开头怎么交出去」。三种走法，按**落在哪条轨**分：
    //   · 落在顶/底轨、且本格是弱驱动（u / d）   → 一条 S 曲线，横跨半格（上游 vmu / vmd）
    //   · 没有可落的轨（z 这类中位字符）          → 上下两条 S 曲线收到中位、半格处汇合（上游 vmz）
    //   · 落在顶/底轨的普通电平                  → 3..9px 的直斜边（上游 vm1 / vm0）
    // 落点在 e2 = 半格：上游把这几种过渡都画满半个字符，虚线/电平线正好从那里接上。
    var r=railStart(ch,T,B), e2=X+W*0.5, fp, ink, pts=[], k, hair='', seg;
    var c1=X+bi+Math.min(4,W*0.10), c2=e2-Math.min(10,W*0.26);
    if(/[ud]/.test(ch)&&(r===T||r===B)){
      var from=(r===T)?B:T, midY=(from+r)/2;
      var cv=' C'+c1+','+midY+' '+c2+','+r+' '+e2+','+r;
      ink='M'+X+','+from+' H'+(X+bi)+cv;
      if(capCls) return '<path class="waveBus '+capCls+'" d="M'+X+','+r+' V'+from+' H'+(X+bi)+cv+' Z" stroke="none"/>'+
        '<path class="waveBusInk" d="'+ink+'"/>';
      // x 的收口没有颜色可填，是一片斜线：裁剪边界只能用**弦**（曲线做不了裁剪线，
      // 这一段弦与曲线差不到 2px，看不出）。x → u/d 本身是很罕见的组合。
      return waveHatch(X,e2,T,B,W,[X,T,X,B],[X+bi,from,e2,r])+'<path class="waveBusInk" d="'+ink+'"/>';
    }
    if(r!==T&&r!==B){
      // 没有可落的轨（z / 其它中位字符）：两条缓弯各自从顶/底轨收到中位，中间填成一片梭形。
      // 收成尖（直斜边）的话，尖点与中位线之间会留一个小三角（tutorial Step 6 的 DQ 尾部）。
      var upC=' C'+c1+','+((T+M)/2)+' '+c2+','+M+' '+e2+','+M;
      var dnC=' C'+c1+','+((B+M)/2)+' '+c2+','+M+' '+e2+','+M;
      ink='M'+X+','+T+' H'+(X+bi)+upC+' M'+X+','+B+' H'+(X+bi)+dnC;
      if(capCls) return '<path class="waveBus '+capCls+'" d="M'+X+','+T+' H'+(X+bi)+upC+
        ' C'+c2+','+M+' '+c1+','+((B+M)/2)+' '+(X+bi)+','+B+' H'+X+' Z" stroke="none"/>'+
        '<path class="waveBusInk" d="'+ink+'"/>';
      return waveHatch(X,e2,T,B,W,[X,T,X,B],[[X,T,e2,M],[X,B,e2,M]])+'<path class="waveBusInk" d="'+ink+'"/>';
    }
    if(r===T){
      fp=[[X,T],[X,B],[X+bi,B],[X+br,T]];
      ink='M'+X+','+B+' H'+(X+bi)+' L'+(X+br)+','+T;
      seg=[X+bi,B,X+br,T];
    } else {
      fp=[[X,T],[X,B],[X+bi,T],[X+br,B]];
      ink='M'+X+','+T+' H'+(X+bi)+' L'+(X+br)+','+B;
      seg=[X+bi,T,X+br,B];
    }
    // 收口没有色块可填时（x 走近上一格）就是一片斜线：斜线要跟本格同一套步距，
    // 且停在收口的斜边上。
    if(!capCls) hair=waveHatch(X,X+br,T,B,W,[X,T,X,B],seg);
    for(k=0;k<fp.length;k++) pts.push(fp[k][0]+','+fp[k][1]);
    return (capCls?'<polygon class="waveBus '+capCls+'" points="'+pts.join(',')+'" stroke="none"/>':'')+
      hair+'<path class="waveBusInk" d="'+ink+'"/>';
  }
  // 相位线：两条 S 曲线 + 白色遮罩（参考上游默认皮肤的视觉风格，自行绘制）
  function waveGap(X,T,B){
    var t=T-2, b=B+2;
    var mask='M'+(X+7)+','+t+' L'+(X+3)+','+t+' C'+(X-2)+','+t+' '+(X-2)+','+b+' '+(X-7)+','+b+' L'+(X-3)+','+b+' C'+(X+2)+','+b+' '+(X+2)+','+t+' '+(X+7)+','+t+' z';
    var c1='M'+(X-7)+','+b+' C'+(X-2)+','+b+' '+(X-2)+','+t+' '+(X+3)+','+t;
    var c2='M'+(X-3)+','+b+' C'+(X+2)+','+b+' '+(X+2)+','+t+' '+(X+7)+','+t;
    return '<g class="waveGapG" pointer-events="none"><path d="'+mask+'" fill="var(--bg)" stroke="none"/>'+
      '<path class="waveInk" d="'+c1+'"/><path class="waveInk" d="'+c2+'"/></g>';
  }
  function waveGlyph(ch,prev,X,T,M,B,W,opt){
    var o=[], x1=X+W, o2=opt||{}, ax=o2.arrowX===undefined?X:o2.arrowX;
    var px=X+3, ex=X+Math.min(W*0.24,9);
    // 认不出的字符按 `x`（未定义）画：源码里可能有我们没建模的写法（老版本 / 手改的笔误）。
    // 以前它会落进最后一条分支、按 waveLevel 的兜底画成一条**中位实线** —— 看起来像一条
    // 正常信号，等于把「这里有东西我没懂」伪装成了「这里是合法的零电平」。斜线填充才是诚实的。
    if(!(Core.BUS.test(ch)||Core.CLOCK.test(ch)||/[01xzud]/.test(ch))) ch='x';
    var e=blockEdge(W), bi=e.bi, br=e.br, bm=e.bm;
    var isBus=Core.BUS.test(ch), isX=(ch==='x');
    // 上一格是**块体**（总线 / x）时，它的收口要由本格画 —— 过渡属于新格，见下面块体分支。
    // 块体自己那半块在块体分支里跟自己的起口一起画。
    // 时钟 / 半周期字符（p P n N h H l L）**不收口**：上游给它们用的是时钟砖块
    // （`pclk` = `M0,20 0,0 20,0`、`nclk` = `m0,0 0,20 20,0`），左边界是一条**竖直**的起沿，
    // 块体就在格线上截断。照普通电平那样画斜收口，`x` 与 `h` 之间会多出一个三角缺口，
    // 而且那一格的高电平比上游短一截（tutorial Step 2 的 clk1 / clk4 首格）。
    if(o2.pblock&&!isBus&&!isX&&!Core.CLOCK.test(ch))
      o.push(blockCap(ch,o2.pbus?(o2.pcls||'bus2'):null,X,T,M,B,W,bi,br,bm));
    if(isBus||isX){
      // 总线与 `x` 都是**满高块体**（x 只是把填充换成斜线），过渡规则完全一样，所以合成一支。
      // 而且「过渡属于新格」：上游把每一笔过渡都画在**新格的头 3..9px** 里（20px 的半格砖内
      // 3..9），上一格只管铺到自己的右边界就说完了。于是：
      //   · 每格只回答「我是从上一格怎么进来的」；右端永远齐头，收口由**下一格**负责
      //     —— 块体因此天然向下一格伸出 9px，和上游一样；
      //   · 进来有四种：
      //       edge  行首 → 齐头
      //       join  上一格是同款块体且属同一段 → 齐头，且不描公共竖边
      //       enter 上一格是电平 → 一条贯穿全高的斜边，起点落在上一格收盘的那条轨
      //       cross 上一格是**另一种块体**（换色 / x 与总线互换 / 问不出轨）→ 两条边交叉
      // 旧实现把边型摊到「左右两侧」，右端收在格线**内** 3..9px，于是同一段比上游短 6px，
      // 接缝处还得靠补横线遮掩。改成单边模型后这些补丁全部不需要了。
      var cls=isBus?(o2.cls||BUS_CLASS[ch]||'bus2'):null;
      var pts=function(a){ var s=[],k; for(k=0;k<a.length;k++) s.push(a[k][0]+','+a[k][1]); return s.join(','); };
      // 候选字符条的缩略图是**图标**不是波形格子：左右各一个 3px 的尖，保持对称。
      if(isBus&&o2.icon){
        o.push('<polygon class="waveBus '+cls+'" points="'+pts([[X+bi,T],[x1-bi,T],[x1,M],[x1-bi,B],[X+bi,B],[X,M]])+'" stroke="none"/>');
        o.push('<path class="waveBusInk" d="M'+(X+bi)+','+T+' H'+(x1-bi)+' M'+(X+bi)+','+B+' H'+(x1-bi)+
          ' M'+X+','+M+' L'+(X+bi)+','+T+' M'+X+','+M+' L'+(X+bi)+','+B+
          ' M'+(x1-bi)+','+T+' L'+x1+','+M+' L'+(x1-bi)+','+B+'"/>');
        return '<g class="waveGlyph" data-w="'+esc(ch)+'" pointer-events="none">'+o.join('')+'</g>';
      }
      // `x` 与总线是同一套块体，但填充不同：总线是**色块**（天然挡住宿主画的列网格），
      // `x` 只有斜线，斜线之间是透空的 —— 网格会从底下透出来，看上去像「网格压在波形上」
      // （用户报的就是这个：只有 `x` 会这样，总线不会）。上游没有列网格，所以它没这个问题。
      // 先给这一格铺一层画布底色，`x` 在带内就是实心块，与总线行为一致；底色跟着主题走。
      if(isX) o.push('<rect class="waveHatchBg" x="'+X+'" y="'+T+'" width="'+W+'" height="'+(B-T)+
        '" fill="var(--bg)" stroke="none" pointer-events="none"/>');
      var kind=o2.pblock?(o2.psame?'join':'cross'):(prev?'enter':'edge');
      var ra=(kind==='enter')?railEnd(prev,T,B):null;
      // 上一格问不出轨 = 它是 `z`（中位线）。`z` 不是块体，不能当交叉过渡画 ——
      // 交叉的两条斜线从顶轨和底轨起，中线接不进去，格线上会断开一截（上游这里用的是 zmx 砖块）。
      if(kind==='enter'&&ra!==T&&ra!==B) kind='mid';
      var fp, bd, left=null;
      if(kind==='cross'||kind==='mid'){
        // 两种进法共用同一块体：从 X+9 起、带一个中高度尖；x 的斜线也就从 X+9 开始。
        fp=[[X+br,T],[x1,T],[x1,B],[X+br,B],[X+bm,M]];
        left=[X+br,T,X+br,B];
        if(kind==='mid'){
          // 中位线 → 块体（上游 zmx-brick）：中线走到 X+6 在那里分叉，一条到顶轨、一条到底轨。
          bd='M'+X+','+M+' H'+(X+bm)+
             ' M'+(X+bm)+','+M+' L'+(X+br)+','+T+' M'+(X+bm)+','+M+' L'+(X+br)+','+B+
             ' M'+(X+br)+','+T+' H'+x1+' M'+(X+br)+','+B+' H'+x1;
        } else {
          // 交叉过渡（上游 vmv-brick / xmv-brick）：两段各从自己的格边起一条斜线，交叉处是腰。
          bd='M'+(X+br)+','+T+' H'+x1+' M'+(X+br)+','+B+' H'+x1+
             ' M'+(X+bi)+','+T+' L'+(X+br)+','+B+' M'+(X+bi)+','+B+' L'+(X+br)+','+T+
             ' M'+X+','+T+' H'+(X+bi)+' M'+X+','+B+' H'+(X+bi);
        }
        // 上一段若是总线，把它的收口（一条竖带 + 尖）补上；若是 x，补的是同一形状的**斜线**。
        // 缺了这半块，斜线带就会在格线上被平切，与下一块之间留一道白缝（上游两段是收成同一个尖对触的）。
        // 只有 `cross` 才补 —— `mid` 的上一格是 `z`（中位线，不是块体），根本不存在「上一段的收口」。
        // 少了这个判据，`z` 接 `x` 时会在格线左侧凭空画出一小片斜线（浮在带体外面）。
        if(kind==='cross'&&!o2.psame){
          if(o2.pbus) o.push('<polygon class="waveBus '+(o2.pcls||'bus2')+'" points="'+
            pts([[X+bi,T],[X,T],[X,B],[X+bi,B],[X+bm,M]])+'" stroke="none"/>');
          else o.push(waveHatch(X,X+bm,T,B,W,[X,T,X,B],capEdges(X,bi,bm,T,M,B)));
        }
        // 斜线的左边界是**分叉的那两条斜边**，不是 X+9 那条竖线 —— 分叉与块体左沿之间
        // 那块楔形（宽 6px）同样要在带里，上游 `zmx` 的斜线一直填到叉口上；按竖线裁
        // 会在叉口右侧留一个白色三角。
        left=(kind==='mid')?[[X+bm,M,X+br,T],[X+bm,M,X+br,B]]:[X+br,T,X+br,B];
      } else if(kind==='enter'){
        // 斜边从上一格收盘的轨（ra）斜到另一条轨；那条轨的横线一直铺到格线，接缝才不露。
        fp=(ra===T)?[[X+bi,T],[x1,T],[x1,B],[X+br,B]]:[[X+br,T],[x1,T],[x1,B],[X+bi,B]];
        bd=(ra===T)
          ? 'M'+X+','+T+' H'+x1+' M'+(X+br)+','+B+' H'+x1+' M'+(X+bi)+','+T+' L'+(X+br)+','+B
          : 'M'+X+','+B+' H'+x1+' M'+(X+br)+','+T+' H'+x1+' M'+(X+bi)+','+B+' L'+(X+br)+','+T;
        left=(ra===T)?[X+bi,T,X+br,B]:[X+bi,B,X+br,T];
      } else {
        fp=[[X,T],[x1,T],[x1,B],[X,B]];
        bd='M'+X+','+T+' H'+x1+' M'+X+','+B+' H'+x1;
      }
      // 总线：色块只负责填充，轮廓另画一条 path；齐头那一侧**不描竖边**，段内才没有分界线。
      // x：不填充，改用斜线，斜线要在过渡让出来的空缺外面停住（上游是逐条线裁的）。
      if(isBus) o.push('<polygon class="waveBus '+cls+'" points="'+pts(fp)+'" stroke="none"/>');
      else o.push(waveHatch(X,x1,T,B,W,left,null));
      o.push('<path class="'+(isBus?'waveBusInk':'waveInk')+'" d="'+bd+'"/>');
    } else if(Core.CLOCK.test(ch)){
      // 时钟 / 半周期状态的**边沿要不要画**，取决于上一个字符收在哪条轨上（上游 xclude 的语义）：
      // 已经停在目标电平上就只画平段，否则才画那条起沿。少了这一步，`hp` / `pl` 这类连续
      // 字符会在格子边界多出一条横穿整行的竖线（Step 2 的 clk0 / clk2 最显眼）。
      var up=/[pPhH]/.test(ch), pl=prev?railEnd(prev,T,B):null, d, edge;
      if(/[pPnN]/.test(ch)){
        // 完整时钟：前半段电平 first、后半段 second，中间那次跳变始终要画；
        // 起沿只在「上一格没收在 first」时才画（已在该电平 = 上游 xclude 的情形）。
        var first=up?T:B, second=up?B:T, start=(pl===first)?first:second;
        d='M'+X+','+start+(start===first?'':' V'+first)+' H'+(X+W/2)+' V'+second+' H'+x1;
        edge=true;                                  // 中间那次跳变恒存在
      } else {
        // 半周期状态（h/H 高、l/L 低）：目标是单一电平
        var lev=up?T:B;
        edge=(pl!==lev);                            // 已经在目标电平上就没有边沿
        d=edge?'M'+X+','+(up?B:T)+' V'+lev+' H'+x1:'M'+X+','+lev+' H'+x1;
      }
      o.push('<path class="waveInk" d="'+d+'"/>');
      // 箭头挂在**那条边沿**上：没有跳变（`L.` 的延续格、已在低电平的 `lL`）就不该有箭头。
      // 完整时钟 p/P/n/N 每格都有中间那次跳变，所以延续格照样要有箭头（`P.......` 上游是 8 个）。
      if(/[PHNL]/.test(ch) && edge) o.push(waveArrow(ax,T,B,up));
    } else {
      // `u` / `d` 是**弱驱动**：电平段画虚线，而切换那一笔是**实线的 S 曲线、横跨近半格**
      // （上游 umd / dm0 等砖块：先水平 3px，再用三次贝塞尔在中点附近拐过去，跨度 17/20 砖）。
      // 以前整格都用虚线、过渡也只是 6px 的直线斜坡 —— 看上去就是「虚线直直地斜下去」，
      // 和上游那种「一个缓弯落到位、然后接虚线电平」完全不是一回事。
      var cy=waveLevel(ch,T,M,B); if(cy===null) cy=M;
      var py=prev?waveLevel(prev,T,M,B):null;
      var dash=(ch==='d'||ch==='u');
      // 软过渡 = 进出「无驱动」的状态。上游这几类一律「先水平 3px，再用三次贝塞尔横跨近半格」：
      //   · 进 z（1mz / 0mz）：高/低 → 中位，软的；
      //   · 出 z（zm1 / zm0）：普通 6px 斜边，但**从 6px 起拐**（中位线先走到叉点）；
      //   · u / d 的来回（umd / dmu / um0）：都软。
      // 所以判据只把 `ch === 'z'` 与 prev 的 u/d 算进来 —— 把 prev 的 z 也算进来，
      // 离开高阻就成了慢弯，与上游正好相反。
      var soft=dash||/[ud]/.test(prev||'')||ch==='z';
      if(prev==='z') px=X+bm;          // 中位线先走到叉点再拐（上游 zm1 的 6px）
      var vary=(py!==null&&Math.abs(py-cy)>1);
      // 软曲线落在**半格**处：上游把这类过渡画满半个字符（砖宽 20 / 字符 40），
      // 而虚线正是从后半格才开始的。落在 0.44 格时曲线尖端会戳进虚线的「空隙」里，
      // 看着像半空中断掉一截。同一条跨度也给 blockCap 用，两处才对得上。
      var exS=soft?X+W*0.5:ex, tail;
      var d;
      if(vary){
        d='M'+X+','+py+' H'+px;
        if(soft){
          var c1=px+Math.min(4,W*0.10), c2=exS-Math.min(10,W*0.26);
          d+=' C'+c1+','+((py+cy)/2)+' '+c2+','+cy+' '+exS+','+cy;
        } else d+=' L'+exS+','+cy;
        o.push('<path class="waveInk" d="'+d+'"/>');
        tail='M'+exS+','+cy+' H'+x1;
      } else {
        tail='M'+X+','+cy+' H'+x1;
        // 块体 → 弱驱动（`=` 之后接 `u` / `d`）：收口曲线落在半格处，在此之前电平仍是**实线**
        // —— 上游 vmu-2 的顶线整段实线、后半砖才是 `uuu` 虚线。若这里就从格线铺虚线，
        // 曲线的尖端会正好戳进某个虚线空隙里，看着像半空中断掉一截。
        if(dash&&o2.pblock){
          o.push('<path class="waveInk" d="M'+X+','+cy+' H'+(X+W*0.5)+'"/>');
          tail='M'+(X+W*0.5)+','+cy+' H'+x1;
        } else if(ch==='z'&&o2.pblock){
          // 块体收进 z：中位线从两条缓弯的汇合点（半格）起，否则会横穿那块梭形
          tail='M'+(X+W*0.5)+','+cy+' H'+x1;
        }
      }
      o.push('<path class="'+(dash?'waveDash':'waveInk')+'" d="'+tail+'"/>');
    }
    return '<g class="waveGlyph" data-w="'+esc(ch)+'" pointer-events="none">'+o.join('')+'</g>';
  }

  // 段内所有格共用「段首字符」的 bus 配色：`.` 与 `=` 是延续符，自己没有颜色
  function busClassOf(ch){ return BUS_CLASS[ch]||'bus2'; }

  // 数据标签按**可用宽度**截断。不调 getBBox：每加一个标签就强制一次布局，行数一多就卡。
  // 字符级估算够用（CJK / 全角按 1em，其余按 0.56em —— 10px 字号下即 10 / 5.6px），
  // 而标签只需要「不越过段的边界」，留 4px 余量就能兜住误差。
  function charEm(ch){
    return /[\u2e80-\u9fff\u3000-\u303f\uf900-\ufaff\uff00-\uff60\uffe0-\uffe6]/.test(ch)?1:0.56;
  }
  // 一串文本的**估算宽度**（em 数 × 字号）。画布内没有 getBBox 可用（每加一个标签就强制
  // 一次布局），所以裁断与「标签会不会撞上」都靠这把尺子 —— 只此一份，别处再写系数就散了。
  function textEm(text){
    var s=String(text===null||text===undefined?'':text), w=0, i;
    for(i=0;i<s.length;i++) w+=charEm(s[i]);
    return w;
  }
  function fitLabel(text, room, size){
    var s=String(text===null||text===undefined?'':text);
    if(!s) return '';
    var em=size||10, w=0, i=0, c;
    for(;i<s.length;i++){ c=charEm(s[i])*em; if(w+c>room) break; w+=c; }
    if(i>=s.length) return s;                 // 整串放得下
    var budget=room-charEm('…')*em;           // 放不下：先给省略号留位
    w=0;
    for(i=0;i<s.length;i++){ c=charEm(s[i])*em; if(w+c>budget) break; w+=c; }
    return (s.slice(0,i)||s.charAt(0))+'…';
  }

  // 候选字符背后的单周期缩略波形：与主画布同一个 waveGlyph。
  // 坐标**不按指针分叉**：两端共用 28×26 画布与同一组 y 轨道（5/13/21），只在按钮盒子上
  // 缩放（触摸端与桌面都是同一套规格）。这样同一字符的图案在只读预览与编辑页完全一致。
  function chipGlyph(v){ return waveGlyph(v,null,0,5,13,21,CHIP_W,{arrowX:3,icon:true}); }
  // 字符说明只用于 aria-label（视觉上不再出现 tooltip）。英文是首选语言。
  function chipDesc(v){
    if(Core.BUS.test(v)) return (v==='='||v==='2')?'bus data block (white)':'bus data block, colour '+(Number(v)+5);
    if(Core.CLOCK.test(v)) return {
      p:'clock, rising start', P:'clock, rising start with arrow',
      n:'clock, falling start', N:'clock, falling start with arrow',
      h:'high, rising edge', H:'high, rising edge with arrow',
      l:'low, falling edge', L:'low, falling edge with arrow'}[v];
    return {'1':'high','0':'low','x':'unknown (hatched)','z':'high-Z (mid line)',
      'u':'pull-up (dashed high)','d':'pull-down (dashed low)'}[v]||'wave character';
  }

export { waveGlyph, waveGap, chipGlyph, chipDesc, busClassOf, fitLabel, textEm, blockEdge };
