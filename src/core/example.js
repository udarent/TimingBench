// 默认示例：主页面初始值。语义按公开格式说明编写，非上游源码。
export const EXAMPLE = "{ signal: [\n  // 时钟：| 占一个周期\n  { name: 'clk',  wave: 'p.....|...' },\n"+
    "  { name: 'dat',  wave: 'x.345x|=.x', data: ['head', 'body', 'tail', 'data'] },\n"+
    "  { name: 'req',  wave: '0.1..0|1.0', node: '..a...' },\n  {},\n"+
    "  { name: 'ack',  wave: '1.....|01.' },\n  ['Master',\n    { name: 'wr', wave: '01.0....', node: '.b......' }\n  ]\n"+
    "],\n edge: ['a~>b t1'],\n config: { hscale: 1 }\n}\n";
