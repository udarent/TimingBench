// Default example: initial content of the editor. Semantics follow the public format spec, not upstream source.
export const EXAMPLE = "{ signal: [\n  // clock: one period per |\n  { name: 'clk',  wave: 'p.....|...' },\n"+
    "  { name: 'dat',  wave: 'x.345x|=.x', data: ['head', 'body', 'tail', 'data'] },\n"+
    "  { name: 'req',  wave: '0.1..0|1.0', node: '..a...' },\n  {},\n"+
    "  { name: 'ack',  wave: '1.....|01.' },\n  ['Master',\n    { name: 'wr', wave: '01.0....', node: '.b......' }\n  ]\n"+
    "],\n edge: ['a~>b t1'],\n config: { hscale: 1 }\n}\n";
