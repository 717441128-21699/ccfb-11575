/**
 * 编辑器主程序:状态、渲染循环、绘画工具、面板交互、导入导出。
 */

import { applyGroups, suggestLoopDuration, type CycleGroup, type PaletteImage } from './anim.js';
import { createDemo } from './demo.js';
import { defaultPalette, loadImageFile } from './imageio.js';
import { buildDataJson, buildGif, buildProjectJson, parseProjectJson } from './exporter.js';

// ---------------- 状态 ----------------

type Tool = 'pencil' | 'fill' | 'picker';

interface AppState {
  width: number;
  height: number;
  pixels: Uint8Array;
  basePalette: Uint8ClampedArray;
  animPalette: Uint8ClampedArray;
  groups: CycleGroup[];
  nextGroupId: number;
  brush: number;
  tool: Tool;
  zoom: number;
  ox: number;
  oy: number;
  showGrid: boolean;
  playing: boolean;
  time: number;
  sel: { a: number; b: number } | null;
}

const state: AppState = {
  width: 320,
  height: 200,
  pixels: new Uint8Array(320 * 200),
  basePalette: new Uint8ClampedArray(256 * 3),
  animPalette: new Uint8ClampedArray(256 * 3),
  groups: [] as CycleGroup[],
  nextGroupId: 1,
  brush: 1,
  tool: 'pencil' as Tool,
  zoom: 3,
  ox: 40,
  oy: 40,
  showGrid: false,
  playing: true,
  time: 0,
  sel: null as { a: number; b: number } | null,
};

const GROUP_COLORS = ['#ff5f56', '#ff9ff3', '#c56cf0', '#54a0ff', '#5ac8fa', '#1dd1a1', '#b8e994', '#feca57', '#ff9f43', '#8395a7'];
const MODE_NAMES: Record<CycleGroup['mode'], string> = { cycle: '轮转', pingpong: '往复', lerp: '渐变' };

const undoStack: Uint8Array[] = [];
const UNDO_LIMIT = 64;

// ---------------- DOM ----------------

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
}

const view = $<HTMLCanvasElement>('view');
const viewCtx = view.getContext('2d')!;
const wrap = $('canvasWrap');
const paletteView = $<HTMLCanvasElement>('paletteView');
const palCtx = paletteView.getContext('2d')!;
const fpsEl = $('fps');
const posLabel = $('posLabel');
const sizeLabel = $('sizeLabel');
const zoomLabel = $('zoomLabel');
const statusEl = $('status');
const groupListEl = $('groupList');
const selLabel = $('selLabel');
const btnNewGroup = $<HTMLButtonElement>('btnNewGroup');
const brushSwatch = $('brushSwatch');
const brushLabel = $('brushLabel');
const gifDurInput = $<HTMLInputElement>('gifDur');
const gifFpsInput = $<HTMLInputElement>('gifFps');
const gifInfo = $('gifInfo');

let statusTimer = 0;
function setStatus(msg: string): void {
  statusEl.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => (statusEl.textContent = ''), 5000);
}

// ---------------- 渲染 ----------------

const off = document.createElement('canvas');
const offCtx = off.getContext('2d')!;
let imageData: ImageData;
let px32: Uint32Array;
const pal32 = new Uint32Array(256);

function setupBuffers(): void {
  off.width = state.width;
  off.height = state.height;
  imageData = offCtx.createImageData(state.width, state.height);
  px32 = new Uint32Array(imageData.data.buffer);
}

function renderFrame(): void {
  // 动画调色板 → 32 位颜色表
  const pal = state.animPalette;
  for (let i = 0; i < 256; i++) {
    const o = i * 3;
    pal32[i] = (0xff << 24) | (pal[o + 2] << 16) | (pal[o + 1] << 8) | pal[o];
  }
  // 索引像素 → RGBA(320x200 仅 6.4 万像素,轻松 60fps)
  const pixels = state.pixels;
  for (let p = 0; p < pixels.length; p++) px32[p] = pal32[pixels[p]];
  offCtx.putImageData(imageData, 0, 0);

  // 整数倍最近邻放大,绝不模糊
  const dpr = window.devicePixelRatio || 1;
  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  if (view.width !== cw * dpr || view.height !== ch * dpr) {
    view.width = cw * dpr;
    view.height = ch * dpr;
  }
  viewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  viewCtx.imageSmoothingEnabled = false;
  viewCtx.fillStyle = '#0c0d12';
  viewCtx.fillRect(0, 0, cw, ch);
  viewCtx.drawImage(off, state.ox, state.oy, state.width * state.zoom, state.height * state.zoom);

  if (state.showGrid && state.zoom >= 8) {
    viewCtx.strokeStyle = 'rgba(255,255,255,0.14)';
    viewCtx.lineWidth = 1;
    viewCtx.beginPath();
    for (let x = 0; x <= state.width; x++) {
      const sx = state.ox + x * state.zoom + 0.5;
      viewCtx.moveTo(sx, state.oy);
      viewCtx.lineTo(sx, state.oy + state.height * state.zoom);
    }
    for (let y = 0; y <= state.height; y++) {
      const sy = state.oy + y * state.zoom + 0.5;
      viewCtx.moveTo(state.ox, sy);
      viewCtx.lineTo(state.ox + state.width * state.zoom, sy);
    }
    viewCtx.stroke();
  }
}

const PAL_SW = 22; // 调色板格子尺寸
const PAL_COLS = 16;

function renderPalettePanel(): void {
  const pal = state.animPalette;
  palCtx.clearRect(0, 0, paletteView.width, paletteView.height);
  for (let i = 0; i < 256; i++) {
    const x = (i % PAL_COLS) * PAL_SW;
    const y = Math.floor(i / PAL_COLS) * PAL_SW;
    const o = i * 3;
    palCtx.fillStyle = `rgb(${pal[o]},${pal[o + 1]},${pal[o + 2]})`;
    palCtx.fillRect(x + 1, y + 1, PAL_SW - 2, PAL_SW - 2);
  }
  // 循环组范围标记(底部彩条)
  state.groups.forEach((g, gi) => {
    palCtx.fillStyle = GROUP_COLORS[gi % GROUP_COLORS.length];
    for (let i = g.start; i <= g.end; i++) {
      const x = (i % PAL_COLS) * PAL_SW;
      const y = Math.floor(i / PAL_COLS) * PAL_SW;
      palCtx.fillRect(x + 2, y + PAL_SW - 5, PAL_SW - 4, 3);
    }
  });
  // 选区
  if (state.sel) {
    const a = Math.min(state.sel.a, state.sel.b);
    const b = Math.max(state.sel.a, state.sel.b);
    palCtx.strokeStyle = '#fff';
    palCtx.lineWidth = 1.5;
    for (let i = a; i <= b; i++) {
      const x = (i % PAL_COLS) * PAL_SW;
      const y = Math.floor(i / PAL_COLS) * PAL_SW;
      palCtx.strokeRect(x + 0.75, y + 0.75, PAL_SW - 1.5, PAL_SW - 1.5);
    }
  }
  // 当前画笔颜色
  const bx = (state.brush % PAL_COLS) * PAL_SW;
  const by = Math.floor(state.brush / PAL_COLS) * PAL_SW;
  palCtx.strokeStyle = '#000';
  palCtx.lineWidth = 3;
  palCtx.strokeRect(bx + 1.5, by + 1.5, PAL_SW - 3, PAL_SW - 3);
  palCtx.strokeStyle = '#fff';
  palCtx.lineWidth = 1;
  palCtx.strokeRect(bx + 2.5, by + 2.5, PAL_SW - 5, PAL_SW - 5);

  // 工具栏画笔指示
  const o = state.brush * 3;
  brushSwatch.style.background = `rgb(${pal[o]},${pal[o + 1]},${pal[o + 2]})`;
  brushLabel.textContent = `#${state.brush}`;
}

// ---------------- 主循环 ----------------

let lastNow = performance.now();
let fpsFrames = 0;
let fpsAccum = 0;

function tick(now: number): void {
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  if (state.playing) state.time += dt;
  applyGroups(state.animPalette, state.basePalette, state.groups, state.time);
  renderFrame();
  renderPalettePanel();

  fpsFrames++;
  fpsAccum += dt;
  if (fpsAccum >= 0.5) {
    fpsEl.textContent = `${Math.round(fpsFrames / fpsAccum)} fps`;
    fpsFrames = 0;
    fpsAccum = 0;
  }
  requestAnimationFrame(tick);
}

// ---------------- 绘画 ----------------

function pushUndo(): void {
  undoStack.push(new Uint8Array(state.pixels));
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

function undo(): void {
  const prev = undoStack.pop();
  if (prev) {
    state.pixels.set(prev);
    setStatus('已撤销');
  }
}

function setPixel(x: number, y: number, c: number): void {
  if (x < 0 || y < 0 || x >= state.width || y >= state.height) return;
  state.pixels[y * state.width + x] = c;
}

function drawLine(x0: number, y0: number, x1: number, y1: number, c: number): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPixel(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function floodFill(sx: number, sy: number, c: number): void {
  const { width, height, pixels } = state;
  const target = pixels[sy * width + sx];
  if (target === c) return;
  const stack = [sx, sy];
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (pixels[y * width + x] !== target) continue;
    pixels[y * width + x] = c;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
}

// ---------------- 画布交互 ----------------

let painting = false;
let panning = false;
let spaceDown = false;
let lastIX = 0;
let lastIY = 0;
let lastMX = 0;
let lastMY = 0;

function eventPos(e: MouseEvent): { mx: number; my: number } {
  const rect = view.getBoundingClientRect();
  return { mx: e.clientX - rect.left, my: e.clientY - rect.top };
}

function toImage(mx: number, my: number): { ix: number; iy: number } {
  return {
    ix: Math.floor((mx - state.ox) / state.zoom),
    iy: Math.floor((my - state.oy) / state.zoom),
  };
}

function pickAt(ix: number, iy: number): void {
  if (ix < 0 || iy < 0 || ix >= state.width || iy >= state.height) return;
  state.brush = state.pixels[iy * state.width + ix];
  setStatus(`取色 #${state.brush}`);
}

view.addEventListener('mousedown', (e) => {
  const { mx, my } = eventPos(e);
  const { ix, iy } = toImage(mx, my);
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    panning = true;
    lastMX = mx;
    lastMY = my;
    e.preventDefault();
    return;
  }
  if (e.button === 2) {
    pickAt(ix, iy);
    return;
  }
  if (e.button !== 0) return;
  if (state.tool === 'picker') {
    pickAt(ix, iy);
  } else if (state.tool === 'fill') {
    if (ix >= 0 && iy >= 0 && ix < state.width && iy < state.height) {
      pushUndo();
      floodFill(ix, iy, state.brush);
    }
  } else {
    pushUndo();
    painting = true;
    lastIX = ix;
    lastIY = iy;
    setPixel(ix, iy, state.brush);
  }
});

view.addEventListener('mousemove', (e) => {
  const { mx, my } = eventPos(e);
  const { ix, iy } = toImage(mx, my);
  if (ix >= 0 && iy >= 0 && ix < state.width && iy < state.height) {
    posLabel.textContent = `(${ix}, ${iy}) #${state.pixels[iy * state.width + ix]}`;
  } else {
    posLabel.textContent = '';
  }
  if (panning) {
    state.ox += mx - lastMX;
    state.oy += my - lastMY;
    lastMX = mx;
    lastMY = my;
    return;
  }
  if (painting) {
    drawLine(lastIX, lastIY, ix, iy, state.brush);
    lastIX = ix;
    lastIY = iy;
  }
});

window.addEventListener('mouseup', () => {
  painting = false;
  panning = false;
});

view.addEventListener('contextmenu', (e) => e.preventDefault());

view.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const { mx, my } = eventPos(e);
    const oldZoom = state.zoom;
    const next = Math.max(1, Math.min(16, oldZoom + (e.deltaY < 0 ? 1 : -1)));
    if (next === oldZoom) return;
    // 以鼠标位置为锚点缩放
    state.ox = mx - ((mx - state.ox) / oldZoom) * next;
    state.oy = my - ((my - state.oy) / oldZoom) * next;
    state.zoom = next;
    zoomLabel.textContent = `${next}×`;
  },
  { passive: false }
);

// ---------------- 调色板面板交互 ----------------

let palDragging = false;

function palIndexAt(e: MouseEvent): number {
  const rect = paletteView.getBoundingClientRect();
  const scale = paletteView.width / rect.width;
  const x = (e.clientX - rect.left) * scale;
  const y = (e.clientY - rect.top) * scale;
  const col = Math.floor(x / PAL_SW);
  const row = Math.floor(y / PAL_SW);
  if (col < 0 || col >= PAL_COLS || row < 0 || row >= 16) return -1;
  return row * PAL_COLS + col;
}

paletteView.addEventListener('mousedown', (e) => {
  const idx = palIndexAt(e);
  if (idx < 0) return;
  palDragging = true;
  state.brush = idx;
  state.sel = { a: idx, b: idx };
  updateSelLabel();
});

paletteView.addEventListener('mousemove', (e) => {
  if (!palDragging) return;
  const idx = palIndexAt(e);
  if (idx < 0 || !state.sel) return;
  state.sel.b = idx;
  updateSelLabel();
});

window.addEventListener('mouseup', () => {
  palDragging = false;
});

function updateSelLabel(): void {
  if (!state.sel) {
    selLabel.textContent = '';
    btnNewGroup.disabled = true;
    return;
  }
  const a = Math.min(state.sel.a, state.sel.b);
  const b = Math.max(state.sel.a, state.sel.b);
  const n = b - a + 1;
  selLabel.textContent = n >= 2 ? `选区 #${a}–#${b}(${n} 色)` : `#${a}`;
  btnNewGroup.disabled = n < 2;
}

// ---------------- 循环组面板 ----------------

function renderGroups(): void {
  groupListEl.innerHTML = '';
  state.groups.forEach((g, gi) => {
    const color = GROUP_COLORS[gi % GROUP_COLORS.length];
    const row = document.createElement('div');
    row.className = 'group';

    const dot = document.createElement('span');
    dot.className = 'gdot';
    dot.style.background = color;

    const name = document.createElement('input');
    name.className = 'gname';
    name.type = 'text';
    name.value = g.name;
    name.addEventListener('input', () => (g.name = name.value));

    const range = document.createElement('span');
    range.className = 'grange';
    range.textContent = `#${g.start}–#${g.end} · ${g.end - g.start + 1}色`;

    const ctrl = document.createElement('div');
    ctrl.className = 'gctrl';

    const modeSel = document.createElement('select');
    for (const m of ['cycle', 'pingpong', 'lerp'] as const) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = MODE_NAMES[m];
      modeSel.appendChild(opt);
    }
    modeSel.value = g.mode;
    modeSel.title = '轮转=单向循环 往复=来回 渐变=平滑插值';
    modeSel.addEventListener('change', () => {
      g.mode = modeSel.value as CycleGroup['mode'];
      refreshGifDuration();
    });

    const speed = document.createElement('input');
    speed.type = 'number';
    speed.min = '0';
    speed.max = '64';
    speed.step = '0.5';
    speed.value = String(g.speed);
    speed.title = '速度:每秒移动的色格数';
    speed.addEventListener('change', () => {
      g.speed = Math.max(0, Math.min(64, parseFloat(speed.value) || 0));
      speed.value = String(g.speed);
      refreshGifDuration();
    });

    const dir = document.createElement('button');
    dir.className = 'gdir';
    dir.textContent = g.direction === 1 ? '→' : '←';
    dir.title = '方向';
    dir.addEventListener('click', (e) => {
      e.stopPropagation();
      g.direction = g.direction === 1 ? -1 : 1;
      dir.textContent = g.direction === 1 ? '→' : '←';
    });

    const enabledLabel = document.createElement('label');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = g.enabled;
    enabled.title = '启用';
    enabled.addEventListener('change', () => {
      g.enabled = enabled.checked;
      refreshGifDuration();
    });
    enabledLabel.appendChild(enabled);

    const del = document.createElement('button');
    del.className = 'gdel';
    del.textContent = '✕';
    del.title = '删除该组';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      state.groups.splice(gi, 1);
      renderGroups();
      refreshGifDuration();
    });

    ctrl.append(modeSel, speed, dir, enabledLabel, del);
    row.append(dot, name, range, ctrl);
    // 点击行 → 在调色板上亮出该组范围
    row.addEventListener('click', () => {
      state.sel = { a: g.start, b: g.end };
      updateSelLabel();
    });
    groupListEl.appendChild(row);
  });
}

btnNewGroup.addEventListener('click', () => {
  if (!state.sel) return;
  const a = Math.min(state.sel.a, state.sel.b);
  const b = Math.max(state.sel.a, state.sel.b);
  if (b - a + 1 < 2) return;
  const id = state.nextGroupId++;
  state.groups.push({
    id,
    name: `组 ${id}`,
    start: a,
    end: b,
    mode: 'cycle',
    speed: 8,
    direction: 1,
    enabled: true,
  });
  renderGroups();
  refreshGifDuration();
  setStatus(`已新建循环组 #${a}–#${b}`);
});

function refreshGifDuration(): void {
  gifDurInput.value = suggestLoopDuration(state.groups).toFixed(1);
}

// ---------------- 图片载入 ----------------

function setImage(img: PaletteImage, groups: CycleGroup[]): void {
  state.width = img.width;
  state.height = img.height;
  state.pixels = img.pixels;
  state.basePalette = img.palette;
  state.groups = groups;
  state.nextGroupId = groups.reduce((m, g) => Math.max(m, g.id), 0) + 1;
  undoStack.length = 0;
  setupBuffers();
  fitView();
  renderGroups();
  refreshGifDuration();
  sizeLabel.textContent = `${img.width}×${img.height}`;
}

function fitView(): void {
  const cw = wrap.clientWidth || 800;
  const ch = wrap.clientHeight || 600;
  state.zoom = Math.max(1, Math.min(16, Math.floor(Math.min((cw - 40) / state.width, (ch - 40) / state.height))));
  state.ox = Math.round((cw - state.width * state.zoom) / 2);
  state.oy = Math.round((ch - state.height * state.zoom) / 2);
  zoomLabel.textContent = `${state.zoom}×`;
}

// ---------------- 导入 / 导出 ----------------

function download(data: BlobPart, name: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('btnImport').addEventListener('click', () => $<HTMLInputElement>('fileImage').click());
$('fileImage').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('fileImage');
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const { image, exact } = await loadImageFile(file);
    setImage(image, []);
    setStatus(exact ? `已导入索引色 PNG,保留原色号(${image.width}×${image.height})` : `已导入并量化为 256 色(${image.width}×${image.height})`);
  } catch (err) {
    setStatus(`导入失败:${err instanceof Error ? err.message : String(err)}`);
  }
});

$('btnOpenProject').addEventListener('click', () => $<HTMLInputElement>('fileProject').click());
$('fileProject').addEventListener('change', async () => {
  const input = $<HTMLInputElement>('fileProject');
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const proj = parseProjectJson(await file.text());
    setImage(proj.image, proj.groups);
    setStatus('工程已载入');
  } catch (err) {
    setStatus(`打开失败:${err instanceof Error ? err.message : String(err)}`);
  }
});

$('btnSaveProject').addEventListener('click', () => {
  download(buildProjectJson(currentImage(), state.groups), 'project.palette.json', 'application/json');
  setStatus('工程已保存');
});

$('btnExportData').addEventListener('click', () => {
  const includePixels = $<HTMLInputElement>('chkPixels').checked;
  download(buildDataJson(currentImage(), state.groups, includePixels), 'palette-anim.json', 'application/json');
  setStatus('动画数据 JSON 已导出');
});

$('btnExportPng').addEventListener('click', () => {
  off.toBlob((blob) => {
    if (blob) download(blob, 'frame.png', 'image/png');
  }, 'image/png');
});

$('btnExportGif').addEventListener('click', () => {
  const dur = Math.max(0.5, Math.min(30, parseFloat(gifDurInput.value) || 4));
  const fps = Math.max(5, Math.min(50, Math.round(parseFloat(gifFpsInput.value) || 20)));
  gifInfo.textContent = '正在编码 GIF…';
  // 让 UI 先刷新再编码
  setTimeout(() => {
    const t0 = performance.now();
    const gif = buildGif(currentImage(), state.groups, dur, fps);
    const ms = Math.round(performance.now() - t0);
    download(gif, 'palette-anim.gif', 'image/gif');
    gifInfo.textContent = `GIF 已导出:${Math.round(dur * fps)} 帧,${(gif.length / 1024).toFixed(0)} KB,编码耗时 ${ms}ms`;
  }, 30);
});

$('btnNew').addEventListener('click', () => {
  const w = Math.max(8, Math.min(1024, parseInt(prompt('画布宽度', '320') ?? '', 10) || 320));
  const h = Math.max(8, Math.min(1024, parseInt(prompt('画布高度', '200') ?? '', 10) || 200));
  setImage({ width: w, height: h, pixels: new Uint8Array(w * h), palette: defaultPalette() }, []);
  setStatus(`已新建 ${w}×${h} 画布`);
});

$('btnDemo').addEventListener('click', () => {
  const demo = createDemo();
  setImage(demo.image, demo.groups);
  setStatus('已载入演示图(瀑布/火焰/霓虹/灯带/星空/岩浆)');
});

function currentImage(): PaletteImage {
  return { width: state.width, height: state.height, pixels: state.pixels, palette: state.basePalette };
}

// ---------------- 工具栏 ----------------

function setTool(t: Tool): void {
  state.tool = t;
  for (const [tool, id] of [
    ['pencil', 'toolPencil'],
    ['fill', 'toolFill'],
    ['picker', 'toolPicker'],
  ] as const) {
    $(id).classList.toggle('active', tool === t);
  }
}

$('toolPencil').addEventListener('click', () => setTool('pencil'));
$('toolFill').addEventListener('click', () => setTool('fill'));
$('toolPicker').addEventListener('click', () => setTool('picker'));

$('btnGrid').addEventListener('click', () => {
  state.showGrid = !state.showGrid;
  $('btnGrid').classList.toggle('active', state.showGrid);
});

$('btnUndo').addEventListener('click', undo);

$('btnPlay').addEventListener('click', () => {
  state.playing = !state.playing;
  $('btnPlay').textContent = state.playing ? '⏸ 暂停' : '▶ 播放';
});

$('btnResetTime').addEventListener('click', () => {
  state.time = 0;
});

$('btnZoomIn').addEventListener('click', () => zoomStep(1));
$('btnZoomOut').addEventListener('click', () => zoomStep(-1));

function zoomStep(d: number): void {
  const cw = wrap.clientWidth;
  const ch = wrap.clientHeight;
  const old = state.zoom;
  const next = Math.max(1, Math.min(16, old + d));
  if (next === old) return;
  state.ox = cw / 2 - ((cw / 2 - state.ox) / old) * next;
  state.oy = ch / 2 - ((ch / 2 - state.oy) / old) * next;
  state.zoom = next;
  zoomLabel.textContent = `${next}×`;
}

// ---------------- 键盘 ----------------

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
  if (e.key === ' ') {
    spaceDown = true;
    e.preventDefault();
  } else if (e.key === 'b' || e.key === 'B') setTool('pencil');
  else if (e.key === 'f' || e.key === 'F') setTool('fill');
  else if (e.key === 'i' || e.key === 'I') setTool('picker');
  else if (e.key === 'g' || e.key === 'G') $('btnGrid').click();
  else if (e.key === '[') state.brush = (state.brush + 255) % 256;
  else if (e.key === ']') state.brush = (state.brush + 1) % 256;
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ') spaceDown = false;
});

// ---------------- 启动 ----------------

const demo = createDemo();
setImage(demo.image, demo.groups);
requestAnimationFrame(tick);
