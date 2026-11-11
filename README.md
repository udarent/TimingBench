# TimingBench

English · [简体中文](README.zh-CN.md)

**WaveJSON ⇄ editable timing diagrams.** Edit the diagram and the source is rewritten; edit the source and the diagram redraws — both stay in sync.

`0.4.0` · [MIT](LICENSE) · static-only · zero build · zero dependencies · runs entirely locally · [Open online](https://udarent.github.io/TimingBench/)

There is only one source of truth: diagram edits are written back as a minimal patch (comments, indentation, key order and quotes are preserved), and the result is rolled back if it is not equivalent to the diagram. Your source is never silently corrupted.

## See it in action

```js
{ signal: [
    { name: 'clk', wave: 'p.....|...' },
    { name: 'dat', wave: 'x.345x|=.x', data: ['head', 'body', 'tail', 'data'] },
    { name: 'req', wave: '0.1..0|1.0', node: '..a...' },
    { name: 'ack', wave: '1.....|01.' }
  ], edge: ['a~>b t1'] }
```

Open the page and you get this source next to its editable timing diagram. Click the third cell of `req` and type `1`: the waveform changes and the same character is written back into the source. Change `p` to `n` in the source and the clock's initial edge flips immediately.

## Quick start

| Goal | How |
|---|---|
| Try it now | [Online editor](https://udarent.github.io/TimingBench/) · phones / tablets switch to the touch layout automatically |
| Run locally | `git clone https://github.com/udarent/TimingBench.git && cd TimingBench && npm start` → <http://127.0.0.1:5173/> |
| Self-host | Put this entire directory on any static server; for GitHub Pages choose `main` / `/ (root)`, no CI needed |
| Preview touch UI on desktop | Append `?touch=1` to the URL |

No `npm install`, no network access, no uploads. Node is used only for the local static server and the pre-commit check. The app uses native ES modules, so **opening `index.html` via `file://` does not work** — it must be served over HTTP.

## What it does

| Feature | Details |
|---|---|
| Bidirectional sync | Diagram → source via a minimal patch; source → diagram redraws ~320 ms after you stop typing; non-equivalent results roll back |
| Waveform editing | Select a cell, then type a character / click the character bar / drag across cells to paint; each chip in the bar shows the waveform it will write |
| Inline editing | Double-click to edit a cell, signal name, data label, node marker, arc, a whole `wave` / `data` / `node` row, or `phase` / `period` |
| Structure editing | Add / remove rows and cycles, phase gaps, row reordering, append a trailing cycle, `group` / `spacer` |
| Nodes and arcs | Click two anchors to connect them; unused letters a–z are assigned automatically; double-click an arc to change its shape / label, clear it to delete |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y`; one paint drag, one row reorder and one arc each count as a single undo step |
| Tolerant parsing | While the source is incomplete, the last valid diagram stays on screen and a red dot shows the error and offset |
| Desktop / touch | Two stacked panes on desktop; coarse-pointer devices get tabs + a bottom action bar instead |
| Privacy | Everything runs in the browser — no requests, no accounts, no backend, no telemetry |

## Operations at a glance

| Goal | Desktop | Touch |
|---|---|---|
| Write a waveform | Click a cell → type / click the character bar; hold and drag horizontally to paint | Tap a cell → tap the character bar (wraps into multiple rows of large chips, no horizontal scrolling) |
| Inline edit | Double-click the target (or `Enter` on a selected cell) | Double-tap the same target within 330 ms, or long-press for 480 ms |
| Connect an arc | Click anchor A → dashed preview follows the pointer → click anchor B | Tap the two anchors in turn; the first one stays highlighted |
| Rows / cycles / phase gaps | Hover the right edge of a row or a column number for `+` `−` `\|` | 14 always-visible buttons in the "Object" panel + 4 in the "Column" panel |
| Reorder rows | Drag the ⠿ handle at the row start | `↑ Move up` / `↓ Move down` |
| Undo / redo | Top ↶ ↷ or `Ctrl+Z` / `Ctrl+Y` | `↶ Undo` / `↷ Redo` in the bottom bar |
| Cancel current mode | `Esc` | `✕ Cancel` in the bottom bar |
| See source / diagram | Both panes visible at once | Switch with the "Diagram / Source" tabs |

Touch hit targets follow the 44 CSS px guideline (cells 46×50, character chips 44×44, action-bar buttons ≥48). Hover-only mini controls are removed. Default gestures are not blocked, so native canvas scrolling and pinch-zoom still work.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `0 1 x z u d p P n N h l H L = 2…9` `.` `\|` | Write to the current cell and move right (see the table below) |
| `Enter` | Inline-edit the current cell |
| `←` `→` `↑` `↓` | Move the selected cell |
| `Ctrl/⌘ + Z` · `Ctrl/⌘ + Y` / `Ctrl+Shift+Z` | Undo · redo |
| `Esc` | Cancel an arc / drag, or clear the selection |

Shortcuts apply only while the canvas has focus.

## Wave character reference

| Group | Characters | Meaning |
|---|---|---|
| Levels | `0` `1` `x` `z` `u` `d` | low · high · unknown (hatched) · high-impedance · pull-up · pull-down |
| Clocks | `p` `n` `h` `l`; uppercase `P` `N` `H` `L` | starting edge / level variants; uppercase adds an arrow |
| Bus | `=` `2`…`9` | data block consuming `data` labels in order; color varies with the digit |
| Auxiliary | `.` `\|` `<` `>` | hold the previous state (no label consumed) · phase gap · sub-cycle switches (no cycle consumed) |
| Nodes / arcs | `node: '..a...'`, `edge: ['a~>b t1']` | markers map to cycle positions; in an edge the first character is the start and the last is the end, `~` curve / `-` straight / `>` arrow in between, text after the space is the label |

Missing trailing cycles are drawn repeater-style with the last state (slightly dimmed); clicking one extends both the source and the diagram, and the change is undoable.

## FAQ and limitations

- **Nothing happens when I double-click the HTML file?** ES modules are blocked by CORS under `file://`. Use `npm start` or any static server; a GitHub Pages deployment works out of the box.
- **Are my diagrams uploaded anywhere?** No. Everything is computed in the browser — no requests, no storage, no account.
- **Does it support all of WaveDrom?** It covers the common subset: `wave` / `data` / `node` / `edge` / `phase` / `period` / `group` / `spacer` and repeater-style fill-in. It is not a full WaveDrom implementation and contains none of its code.
- **Which browsers?** Current Chrome / Edge / Firefox / Safari (ES modules, SVG `foreignObject`, Pointer Events). Older browsers without Pointer Events fall back to touch events.
- **My touchscreen laptop stayed in desktop mode?** If the primary pointer is a mouse, the layout does not switch automatically; append `?touch=1` to force it.
- **Known limitations**: the `foreignObject` input with the iOS Safari soft keyboard has not been verified on a real device; touch mode drops drag-paint and drag-to-reorder (to avoid stealing native scroll gestures), and arcs have no finger-following preview curve.

## Development

`npm run check` runs the pre-commit self-check (bidirectional equivalence, site assets, module imports, version consistency) and exits 1 on failure. The full test suite is not shipped in this repository.

## License and credits

[MIT](LICENSE), covering only this project's own code ([scope](LICENSE.md)). Only WaveDrom Editor's default layout, the public WaveJSON format and the default skin's visual style were referenced; no upstream source, dependency, affiliation or endorsement is involved — see [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md). Feedback: <helloyuechen@163.com>.
