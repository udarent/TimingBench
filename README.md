# TimingBench

`0.3.0` · udarent <helloyuechen@163.com> · 2026-11-11

TimingBench 是 WaveJSON 源码 ⇄ 可编辑时序图的双向编辑器：改图形回写源码（优先最小补丁），改源码重绘图形，两侧由同一套 Canonical IR 与等价判据约束。界面参考 WaveDrom Editor 的默认版式：源码在上、波形在下，上下分区、各占半屏且通栏。**TimingBench 是本项目的名称；文中所有「WaveDrom / WaveJSON / WaveSkin」均指上游项目与格式。**本项目独立实现，不含上游源码或直接复制的代码片段，参照关系见 [`ACKNOWLEDGMENTS.md`](ACKNOWLEDGMENTS.md)。

**纯静态、零构建、零运行时依赖**：浏览器原生 ES modules，没有打包步骤，没有 `npm install`，没有第三方运行时。GitHub Pages 可直接托管本目录（或用子树拆分成独立仓库），无需 CI 构建。

## 从哪里开始

| 想做什么 | 打开 / 运行 |
|---|---|
| 在线体验编辑器 | 打开 Pages 站点根地址（部署方式见下节） |
| 本地运行、边改边看 | `npm start` → 打开 `http://127.0.0.1:5173/` |
| 准备提交前 | `npm run check` 自检 |
| 了解许可与参照关系 | [`LICENSE`](LICENSE) · [`LICENSE.md`](LICENSE.md) · [`ACKNOWLEDGMENTS.md`](ACKNOWLEDGMENTS.md) |
| 查完整操作说明 | 本页「界面与操作」一节 |

## 部署为 GitHub Pages

仓库本身就是可托管的静态站点：根目录 [`index.html`](index.html) 为站点入口，`src/` 为运行时资源，路径全部相对站点根，不含任何需要预构建的文件。

1. 把仓库推送到 GitHub（`git remote add origin <url>` → `git push -u origin main`）。
2. 仓库 **Settings → Pages**，Source 选 *Deploy from a branch*，Branch 选 `main`、目录选 `/ (root)`，保存。
3. 等一两分钟，站点地址为 `https://<用户名>.github.io/TimingBench/`（仓库名为 `<用户名>.github.io` 时则是站点根域名）。

几点说明：

- 根目录的 [`.nojekyll`](.nojekyll) 让 Pages 跳过 Jekyll 处理，静态文件按原样发布；删掉它一般也能跑，但会多一层无意义的 Markdown/ Liquid 处理。
- 所有资源引用都是**相对路径**（`src/styles.css`、`src/main.js`），因此无论站点挂在域名根还是 `/TimingBench/` 子路径下都能正确加载，不需要改 `base`。
- 不需要 Actions 工作流。若将来引入构建步骤，再改用 *GitHub Actions* 作为 Pages 的 Source。
- 仓库里的 `.md`、`package.json`、`serve.mjs`、`selfcheck.mjs` 会随站点一起被托管，但不参与页面加载，不影响运行。

## 本地运行

```bash
npm start     # 零依赖静态服务 → http://127.0.0.1:5173/
npm run check # 提交前保险：单一复杂用例 + 站点入口自洽
```

浏览器打开 `http://127.0.0.1:5173/` 即可（静态服务把 `/` 映射到 `index.html`）。源码形态是原生 ES modules，在 `file://` 下受浏览器 CORS 限制，**本地直接双击打开不生效**，必须经 HTTP 打开（用 `npm start`，或用任意静态服务器）。部署到 GitHub Pages 后是 HTTPS 托管，没有这个限制。

无需 `npm install`、联网或第三方包；Node 只用于起本地静态服务与跑提交前自检。

## 界面与操作

页面上半为 WaveJSON 源码（带行号、不折行、浅灰底），下半为可编辑时序图画布，两区通栏等宽、中间一条水平分隔线，**页面内不展示任何说明文字**。核心规矩是「一种修改只有一种交互」：

- **写波形**：单击格子只选中它（虚线描边），随后直接敲 `0 1 x z u d p P n N h l H L = 2…9` 写入并自动右移，可连着敲出一整段；或点选中后浮出的字符条 —— 每个字符的背景就是它写入后这一格的单周期波形。按住左键横向拖过用当前字符连写。
- **定点改写**：双击任意格子恒为编辑该格波形字符（`Enter` 等价，与字符条共用同一命令），弹出的输入框是长在图元上的 SVG `foreignObject`，`Enter` 确认、`Esc` 取消。节点字符双击格顶的锚点，单槽数据标签点数据块右下角浮现的 ✎ 徽标，信号名 / 弧线 / 整行 wave / data / node 双击即编辑。
- **连弧线**：点第一个节点锚点 → 移动鼠标看虚线预览 → 点第二个锚点，弧线立刻生成；两端缺节点字符会自动分配 a–z 中未用的最小字母，`node` + `edge` 一次提交、一次撤销。双击弧线本体改形状 / 标签，清空即删除；`Esc` / 点同一锚点 / 点画布别处取消。
- **行列结构**：悬停行右端出现行工具（wave / data / node / 增删行），拖行首 ⠿ 重排；悬停列号出现 `|`（相位线）、`+` / `−`（增删周期），末尾追加用第 N 个幽灵列头的 `+`；单击信号名旁的 `φ…` / `T…` 徽标改 phase / period。
- **代码侧**：直接编辑上方源码，停止输入约 320ms 后解析重绘；语法未写完时进入草稿态，保留上次有效图形，右上角红点给出错误与偏移。图形回写优先走 CST 最小补丁（只替换变化字面量，保留注释 / 缩进 / 键序 / 引号），行集合 / 顺序 / group / edge 等结构变化自动回退全量规范化输出；生成代码若解析失败或不等价则回滚报错。
- **撤销重做**：顶部 ↶ / ↷ 或 `Ctrl+Z` / `Ctrl+Y`（`Ctrl+Shift+Z`）；方向键换格，`Esc` 取消连线 / 拖动 / 清除选中。一次拖动漫刷、一次拖动重排、一次两点连线都只算一次撤销；键盘直通仅在焦点位于画布时生效。

**wave 字符**：`0` / `1` 低高电平，`x` / `z` 未知 / 高阻，`u` / `d` 上拉 / 下拉，`p` / `P` / `n` / `N` 与 `h` / `H` / `l` / `L` 时钟及电平变体，`=` 与 `2…9` 总线数据块（按序消耗 `data` 标签），`.` 延续前一状态（不消耗标签），`|` 相位线，`<` / `>` 是 sub-cycle 开关且不占周期。`node: '..a...'` 的标记位置与周期一一对应；edge 串形如 `a~>b t1`，首字符起点、末字符终点，中间 `~` 曲线 / `-` 直线 / `>` 箭头，空格后是标签。短行缺失周期按 repeater 沿用最后一状态补画（略淡），点它写入会自动扩展源码与 IR，可撤销。

## 项目结构

仓库只有一个子目录 `src/`，其余文件全部平铺在根目录 —— 站点入口、许可、脚本、说明一眼可见：

```text
根目录  index.html        站点入口：上下分区双向编辑（GitHub Pages 首页）
        README.md         项目说明与操作手册（本文件）
        LICENSE           MIT 许可证全文
        LICENSE.md        许可范围说明
        ACKNOWLEDGMENTS.md  与 WaveDrom 的参照关系
        VERSION           版本号镜像（权威为 package.json）
        package.json      元信息与 npm scripts
        .nojekyll         让 GitHub Pages 跳过 Jekyll 处理
        .gitignore
        serve.mjs         零依赖静态服务（npm start）
        selfcheck.mjs     提交前自检（npm run check）
src/    main.js           页面入口 · styles.css 共享样式
        core/             ir.js 语义内核 · example.js 默认示例 · util.js 工具
        editor/           index.js 装配 · shapes.js 绘制 · interactions.js 交互
                          waveform.js 波形图元 · geometry.js 布局常量
```

根目录的 `.mjs` 脚本与 `.md` 文档不参与运行时加载。本目录是本项目的**交付物（产品本体）**，与开发工作区的验收链同源同版：可运行页面、运行时源码、许可与参照关系文档、提交前自检都在这里；需求 / 架构 / 变更日志 / 完整验收套件等研发过程资料由开发工作区保管，不在此目录内。

## 提交前检查

```bash
npm run check
```

单一复杂 WaveJSON 用例（注释 / group / spacer / gap / data / node / edge / phase / period）覆盖结构解析、I1 / I2 等价、16 类 `EditOp` 逐类回写、最小补丁保真、两点连线的全量回退、负例与非法输入；并校验版本一致、`index.html` 引用的资源确实存在且不跳出站点根、`.nojekyll` 就位。失败退出码 1。本交付物**不附带**完整验收套件、浏览器断言页或验收辅助页。

## 版本与许可

- 版本以 `package.json` 的 `version` 为权威，`VERSION` 与 `index.html` 的 `<meta name="version">` 为同步镜像。`v0.1.0` / `v0.2.0` / `v0.3.0` 标签均未创建；打 tag 需作者确认。
- 发布内容不含任何上游源码或复制片段，**MIT** 许可（全文 [`LICENSE`](LICENSE)）只覆盖 TimingBench 自有内容；核对清单见 [`LICENSE.md`](LICENSE.md) 与 [`ACKNOWLEDGMENTS.md`](ACKNOWLEDGMENTS.md)。

## 与 WaveDrom 的关系

本项目仅参考 WaveDrom Editor 的默认交互版式、WaveJSON 的公开格式说明，以及默认皮肤在跳变沿箭头、总线配色、线型上的视觉风格——均属设计思路与格式约定层面的参考。**不包含 WaveDrom 的源码、代码片段、运行时文件或打包产物，未复制其函数、查找表或绘制逻辑，也未将其作为依赖引入或链接**；解析、等价判据、SVG 图元与交互均为独立实现。名称与相关权利归各自权利人所有，详见 [`ACKNOWLEDGMENTS.md`](ACKNOWLEDGMENTS.md)。
