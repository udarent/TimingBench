# 致谢与参照关系

## 与 WaveDrom 的关系

TimingBench 是**独立实现**的项目。开发过程中仅在设计思路、格式约定与交互组织方式上参考了上游项目：

- **WaveDrom Editor**（<https://wavedrom.com/editor.html>）的默认版式：源码区在上、波形区在下，上下分区、各占半屏且通栏。这是界面布局与交互组织方式上的参考。
- **WaveJSON** 的公开格式说明：`wave` 字符与周期、`data` 标签、`node` / `edge`、`phase` / `period` 等字段的语义约定。这是数据格式与语义设计上的参考。
- **WaveDrom 默认皮肤的外观规范**：跳变沿箭头、总线配色、线型与相位线的视觉风格。波形图元由本项目自行用 SVG 绘制，属于视觉设计上的借鉴。

**边界声明**：

- 本项目**不包含** WaveDrom 的源码、代码片段、运行时文件或打包产物；**未复制**其函数、查找表或绘制逻辑，也未将其代码作为依赖引入或链接。
- WaveJSON 解析、Canonical IR、等价判据、16 类 `EditOp`、最小补丁、SVG 图元与全部交互代码均由本项目独立编写。
- 本交付物不附带完整验收套件；提交前自检 [`selfcheck.mjs`](selfcheck.mjs) 由本项目依据公开格式说明自行编写，只覆盖一个复杂双向编辑用例，不依赖任何上游实现。
- `src/core/example.js` 中的教程 / 边界用例是按公开格式说明编写的 **WaveJSON 输入数据样例**，用于验证解析与 round-trip，不是上游源码或代码片段；样例里的信号名（如 `pclk` / `nclk`）只是示例字符串。
- `WaveDrom` / `WaveJSON` / `WaveSkin` 与 `wavedrom.com` 的名称及相关权利归各自权利人所有；本文档不构成隶属、授权或背书关系。

## 其他

- 需求 / 架构 / 变更日志 / 完整验收套件等研发过程资料由开发工作区保管，不在本交付物内。
- 项目作者：udarent <helloyuechen@163.com>。

许可范围见 [`LICENSE.md`](LICENSE.md)，项目说明见 [`README.md`](README.md)。
