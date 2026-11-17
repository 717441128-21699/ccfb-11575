// 单一数据源 + 订阅通知,编辑器和数据表都挂在上面,实现双向同步。
import { findMove } from './types.js';
export class Store {
    constructor(char) {
        this.selectedFrame = 0;
        this.facing = 1; // 1 = 朝右,-1 = 朝左
        this.bufferFrames = 8; // 输入缓冲帧数(可配)
        this.listeners = [];
        this.char = char;
        this.selectedMoveId = char.moves[0].id;
    }
    get move() {
        return findMove(this.char, this.selectedMoveId);
    }
    onChange(fn) {
        this.listeners.push(fn);
    }
    // 所有修改都走 update,改完统一通知;src 标记来源,避免表格自我重绘丢焦点
    update(fn, src) {
        fn();
        for (const l of this.listeners)
            l(src);
    }
    selectMove(id) {
        this.update(() => {
            this.selectedMoveId = id;
            this.selectedFrame = 0;
        }, 'panel');
    }
    selectFrame(f) {
        const total = this.move.startup + this.move.active + this.move.recovery;
        this.update(() => { this.selectedFrame = Math.max(0, Math.min(total - 1, f)); }, 'editor');
    }
}
