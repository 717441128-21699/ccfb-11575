// 单一数据源 + 订阅通知,编辑器和数据表都挂在上面,实现双向同步。

import { Character, Move, findMove } from './types.js';

export type ChangeSource = 'editor' | 'table' | 'panel' | 'init';

export class Store {
  char: Character;
  selectedMoveId: string;
  selectedFrame = 0;
  facing: 1 | -1 = 1; // 1 = 朝右,-1 = 朝左
  bufferFrames = 8;   // 输入缓冲帧数(可配)

  private listeners: ((src: ChangeSource) => void)[] = [];

  constructor(char: Character) {
    this.char = char;
    this.selectedMoveId = char.moves[0].id;
  }

  get move(): Move {
    return findMove(this.char, this.selectedMoveId);
  }

  onChange(fn: (src: ChangeSource) => void): void {
    this.listeners.push(fn);
  }

  // 所有修改都走 update,改完统一通知;src 标记来源,避免表格自我重绘丢焦点
  update(fn: () => void, src: ChangeSource): void {
    fn();
    for (const l of this.listeners) l(src);
  }

  selectMove(id: string): void {
    this.update(() => {
      this.selectedMoveId = id;
      this.selectedFrame = 0;
    }, 'panel');
  }

  selectFrame(f: number): void {
    const total = this.move.startup + this.move.active + this.move.recovery;
    this.update(() => { this.selectedFrame = Math.max(0, Math.min(total - 1, f)); }, 'editor');
  }
}
