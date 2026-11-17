// 判定框编辑器:画布上画攻击框/受击框,框随角色朝向镜像;下方是逐帧时间轴。

import { Box, FrameBoxes, Move, Phase, totalFrames } from './types.js';
import { phaseOfFrame } from './frameMath.js';
import { Store } from './store.js';

const SCALE = 2.4;
const OX = 200;  // 原点(脚底)在画布上的 x
const OY = 330;  // 原点 y

export type EditMode = 'select' | 'hit' | 'hurt';

const PHASE_COLOR: Record<Phase, string> = {
  startup: '#d8a93c',
  active: '#d84c4c',
  recovery: '#4c7fd8',
};

export class BoxEditor {
  mode: EditMode = 'select';
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private timeline: HTMLCanvasElement;
  private tctx: CanvasRenderingContext2D;
  private drag: { kind: 'new' | 'move'; boxType: 'hit' | 'hurt'; box?: Box; startX: number; startY: number; orig?: Box } | null = null;
  private selectedBox: { type: 'hit' | 'hurt'; index: number } | null = null;

  constructor(private store: Store, canvas: HTMLCanvasElement, timeline: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.timeline = timeline;
    this.tctx = timeline.getContext('2d')!;
    this.bindMouse();
    store.onChange(() => this.render());
  }

  private get move(): Move { return this.store.move; }
  private get frame(): FrameBoxes { return this.move.frames[this.store.selectedFrame]; }

  // 世界坐标(朝右存储) → 屏幕坐标
  private toScreenX(wx: number): number { return OX + this.store.facing * wx * SCALE; }
  private toScreenY(wy: number): number { return OY + wy * SCALE; }
  private toWorldX(sx: number): number { return this.store.facing * (sx - OX) / SCALE; }
  private toWorldY(sy: number): number { return (sy - OY) / SCALE; }

  private drawBox(b: Box, color: string, selected: boolean): void {
    const x1 = this.toScreenX(b.x);
    const x2 = this.toScreenX(b.x + b.w);
    const y = this.toScreenY(b.y);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.min(x1, x2), y, Math.abs(b.w * SCALE), b.h * SCALE);
    if (selected) {
      this.ctx.strokeStyle = '#fff';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(Math.min(x1, x2), y, Math.abs(b.w * SCALE), b.h * SCALE);
    }
  }

  private drawCharacter(): void {
    const c = this.ctx;
    const f = this.store.facing;
    const phase = phaseOfFrame(this.move, this.store.selectedFrame);
    const px = (wx: number) => this.toScreenX(wx);
    const py = (wy: number) => this.toScreenY(wy);
    c.strokeStyle = '#e8e8e8';
    c.lineWidth = 3;
    c.lineCap = 'round';
    // 躯干
    c.beginPath(); c.moveTo(px(0), py(-70)); c.lineTo(px(0), py(-30)); c.stroke();
    // 腿
    c.beginPath(); c.moveTo(px(0), py(-30)); c.lineTo(px(-10 * f), py(0)); c.stroke();
    c.beginPath(); c.moveTo(px(0), py(-30)); c.lineTo(px(12 * f), py(0)); c.stroke();
    // 头
    c.beginPath(); c.arc(px(0), py(-82), 10, 0, Math.PI * 2); c.stroke();
    // 手臂:发生段后摆,持续段前伸,收招段回落
    let armReach = 8, armY = -62;
    if (phase === 'startup') { armReach = -12; armY = -58; }
    if (phase === 'active') { armReach = 34; armY = -64; }
    if (phase === 'recovery') { armReach = 14; armY = -50; }
    c.beginPath(); c.moveTo(px(0), py(-62)); c.lineTo(px(armReach * f), py(armY)); c.stroke();
    // 脚底原点标记
    c.fillStyle = '#888';
    c.beginPath(); c.arc(px(0), py(0), 3, 0, Math.PI * 2); c.fill();
  }

  render(): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // 地面
    c.strokeStyle = '#555';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, OY); c.lineTo(this.canvas.width, OY); c.stroke();

    this.drawCharacter();

    this.frame.hurt.forEach((b, i) =>
      this.drawBox(b, 'rgba(60,180,90,0.45)', this.selectedBox?.type === 'hurt' && this.selectedBox.index === i));
    this.frame.hit.forEach((b, i) =>
      this.drawBox(b, 'rgba(220,60,60,0.5)', this.selectedBox?.type === 'hit' && this.selectedBox.index === i));

    // 信息行
    const m = this.move;
    const phase = phaseOfFrame(m, this.store.selectedFrame);
    const phaseName = { startup: '发生', active: '持续', recovery: '收招' }[phase];
    c.fillStyle = '#ddd';
    c.font = '13px sans-serif';
    c.fillText(
      `${m.name}  第 ${this.store.selectedFrame} 帧(${phaseName})  朝向:${this.store.facing === 1 ? '右' : '左'}  模式:${{ select: '选择/移动', hit: '画攻击框', hurt: '画受击框' }[this.mode]}`,
      8, 18);
    this.renderTimeline();
  }

  private renderTimeline(): void {
    const t = this.tctx;
    const m = this.move;
    const total = totalFrames(m);
    const cell = Math.max(14, Math.min(30, Math.floor(this.timeline.width / total)));
    this.timeline.width = cell * total + 2;
    this.timeline.height = 64;
    t.clearRect(0, 0, this.timeline.width, this.timeline.height);

    for (let f = 0; f < total; f++) {
      const phase = phaseOfFrame(m, f);
      const x = f * cell;
      t.fillStyle = PHASE_COLOR[phase];
      t.fillRect(x, 0, cell - 1, 20);
      // 迷你角色姿态
      t.save();
      t.translate(x + cell / 2, 58);
      t.scale(0.28, 0.28);
      t.strokeStyle = '#ccc';
      t.lineWidth = 3;
      t.beginPath(); t.arc(0, -82, 10, 0, Math.PI * 2); t.stroke();
      t.beginPath(); t.moveTo(0, -70); t.lineTo(0, -30); t.stroke();
      t.beginPath(); t.moveTo(0, -30); t.lineTo(-10, 0); t.moveTo(0, -30); t.lineTo(12, 0); t.stroke();
      const reach = phase === 'active' ? 34 : phase === 'startup' ? -12 : 14;
      t.beginPath(); t.moveTo(0, -62); t.lineTo(reach, -60); t.stroke();
      // 该帧的框(缩略)
      const fr = m.frames[f];
      t.fillStyle = 'rgba(60,180,90,0.5)';
      for (const b of fr.hurt) t.fillRect(b.x, b.y, b.w, b.h);
      t.fillStyle = 'rgba(220,60,60,0.6)';
      for (const b of fr.hit) t.fillRect(b.x, b.y, b.w, b.h);
      t.restore();
      // 帧号
      t.fillStyle = '#999';
      t.font = '9px sans-serif';
      t.fillText(String(f), x + 2, 30);
    }

    // 取消窗口标记
    if (m.cancelWindow) {
      t.strokeStyle = '#b46ce0';
      t.lineWidth = 2;
      const x1 = m.cancelWindow.start * cell;
      const x2 = (m.cancelWindow.end + 1) * cell - 1;
      t.strokeRect(x1, 1, x2 - x1, 18);
    }
    // 当前帧高亮
    t.strokeStyle = '#fff';
    t.lineWidth = 2;
    t.strokeRect(this.store.selectedFrame * cell + 0.5, 0.5, cell - 1, 62);
  }

  private canvasPos(e: MouseEvent): { wx: number; wy: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      wx: this.toWorldX(e.clientX - r.left),
      wy: this.toWorldY(e.clientY - r.top),
    };
  }

  private hitTest(wx: number, wy: number): { type: 'hit' | 'hurt'; index: number } | null {
    for (const type of ['hit', 'hurt'] as const) {
      const arr = this.frame[type];
      for (let i = arr.length - 1; i >= 0; i--) {
        const b = arr[i];
        if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return { type, index: i };
      }
    }
    return null;
  }

  private bindMouse(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      const { wx, wy } = this.canvasPos(e);
      if (this.mode === 'hit' || this.mode === 'hurt') {
        const box: Box = { x: Math.round(wx), y: Math.round(wy), w: 1, h: 1 };
        this.drag = { kind: 'new', boxType: this.mode, box, startX: wx, startY: wy };
      } else {
        const hit = this.hitTest(wx, wy);
        this.selectedBox = hit;
        if (hit) {
          const b = this.frame[hit.type][hit.index];
          this.drag = { kind: 'move', boxType: hit.type, box: b, startX: wx, startY: wy, orig: { ...b } };
        }
        this.render();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      const { wx, wy } = this.canvasPos(e);
      const d = this.drag;
      this.store.update(() => {
        if (d.kind === 'new' && d.box) {
          d.box.x = Math.round(Math.min(d.startX, wx));
          d.box.y = Math.round(Math.min(d.startY, wy));
          d.box.w = Math.max(2, Math.round(Math.abs(wx - d.startX)));
          d.box.h = Math.max(2, Math.round(Math.abs(wy - d.startY)));
        } else if (d.kind === 'move' && d.box && d.orig) {
          d.box.x = Math.round(d.orig.x + wx - d.startX);
          d.box.y = Math.round(d.orig.y + wy - d.startY);
        }
      }, 'editor');
    });
    window.addEventListener('mouseup', () => {
      if (this.drag?.kind === 'new' && this.drag.box) {
        const box = this.drag.box;
        const type = this.drag.boxType;
        this.store.update(() => { this.frame[type].push(box); }, 'editor');
      }
      this.drag = null;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' && this.selectedBox) {
        const { type, index } = this.selectedBox;
        this.store.update(() => { this.frame[type].splice(index, 1); }, 'editor');
        this.selectedBox = null;
      }
    });
    this.timeline.addEventListener('mousedown', (e) => {
      const r = this.timeline.getBoundingClientRect();
      const total = totalFrames(this.move);
      const cell = this.timeline.width / total;
      this.store.selectFrame(Math.floor((e.clientX - r.left) / cell));
    });
  }
}
