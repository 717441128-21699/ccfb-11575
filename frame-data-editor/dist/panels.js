// 侧边面板:有利帧计算、取消编辑、输入缓冲/搓招识别、连段验证器。
import { findMove } from './types.js';
import { advantageOnHit, advantageOnBlock, canPunish } from './frameMath.js';
import { recognizeCommands } from './input.js';
import { simulateCombo } from './combo.js';
function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls)
        e.className = cls;
    if (text !== undefined)
        e.textContent = text;
    return e;
}
// ---------- 1. 有利帧 / 确反计算 ----------
export class AdvantagePanel {
    constructor(store, root) {
        this.store = store;
        this.root = root;
        this.atkSel = document.createElement('select');
        this.defSel = document.createElement('select');
        this.out = el('div', 'panel-out');
        store.onChange(() => this.render());
    }
    render() {
        const moves = this.store.char.moves;
        for (const sel of [this.atkSel, this.defSel]) {
            const prev = sel.value;
            sel.innerHTML = '';
            for (const m of moves) {
                const o = el('option', '', `${m.name} (${m.id})`);
                o.value = m.id;
                sel.appendChild(o);
            }
            sel.value = prev || moves[0].id;
        }
        this.atkSel.onchange = this.defSel.onchange = () => this.compute();
        this.root.innerHTML = '';
        this.root.appendChild(el('h3', '', '有利帧 / 确反计算'));
        const row = el('div', 'row');
        row.appendChild(el('span', '', '攻方'));
        row.appendChild(this.atkSel);
        row.appendChild(el('span', '', ' 守方'));
        row.appendChild(this.defSel);
        this.root.appendChild(row);
        this.root.appendChild(this.out);
        this.compute();
    }
    compute() {
        const atk = findMove(this.store.char, this.atkSel.value || this.store.char.moves[0].id);
        const def = findMove(this.store.char, this.defSel.value || this.store.char.moves[0].id);
        const ah = advantageOnHit(atk);
        const ab = advantageOnBlock(atk);
        this.out.innerHTML = '';
        this.out.appendChild(el('div', '', `${atk.name}:命中 ${ah >= 0 ? '+' : ''}${ah} 帧 / 被防 ${ab >= 0 ? '+' : ''}${ab} 帧`));
        const punish = canPunish(ab, def);
        const line = el('div', punish ? 'bad' : 'good', punish
            ? `${def.name}(发生 ${def.startup}F)可以确反!`
            : `${def.name}(发生 ${def.startup}F)无法确反`);
        this.out.appendChild(line);
        const all = this.store.char.moves.filter((m) => canPunish(ab, m));
        this.out.appendChild(el('div', 'dim', all.length ? `能确反的招:${all.map((m) => m.name).join('、')}` : '没有任何招能确反,安全。'));
    }
}
// ---------- 2. 取消窗口 / 取消表编辑 ----------
export class CancelPanel {
    constructor(store, root) {
        this.store = store;
        this.root = root;
        store.onChange(() => this.render());
    }
    render() {
        const m = this.store.move;
        this.root.innerHTML = '';
        this.root.appendChild(el('h3', '', `取消设置:${m.name}`));
        const winRow = el('div', 'row');
        winRow.appendChild(el('span', '', '取消窗口(帧): '));
        const mkNum = (v, set) => {
            const i = el('input', 'cell-input tiny');
            i.type = 'number';
            i.value = String(v);
            i.onchange = () => this.store.update(() => set(Math.max(0, Math.floor(Number(i.value) || 0))), 'panel');
            return i;
        };
        if (m.cancelWindow) {
            winRow.appendChild(mkNum(m.cancelWindow.start, (v) => { m.cancelWindow.start = v; }));
            winRow.appendChild(el('span', '', ' - '));
            winRow.appendChild(mkNum(m.cancelWindow.end, (v) => { m.cancelWindow.end = v; }));
            const off = el('button', 'btn', '移除窗口');
            off.onclick = () => this.store.update(() => { m.cancelWindow = null; }, 'panel');
            winRow.appendChild(off);
        }
        else {
            winRow.appendChild(el('span', 'dim', '无 '));
            const on = el('button', 'btn', '添加窗口');
            on.onclick = () => this.store.update(() => {
                m.cancelWindow = { start: m.startup, end: m.startup + m.active + 2 };
            }, 'panel');
            winRow.appendChild(on);
        }
        this.root.appendChild(winRow);
        this.root.appendChild(el('div', '', '可取消成:'));
        const list = el('div', 'row wrap');
        for (const other of this.store.char.moves) {
            if (other.id === m.id)
                continue;
            const label = el('label', 'chk');
            const cb = el('input');
            cb.type = 'checkbox';
            cb.checked = m.cancelInto.includes(other.id);
            cb.onchange = () => this.store.update(() => {
                const i = m.cancelInto.indexOf(other.id);
                if (cb.checked && i < 0)
                    m.cancelInto.push(other.id);
                if (!cb.checked && i >= 0)
                    m.cancelInto.splice(i, 1);
            }, 'panel');
            label.appendChild(cb);
            label.appendChild(document.createTextNode(other.name));
            list.appendChild(label);
        }
        this.root.appendChild(list);
    }
}
// ---------- 3. 输入缓冲 / 搓招识别 ----------
export class InputPanel {
    constructor(store, root) {
        this.store = store;
        this.root = root;
        this.events = [];
        this.frame = 0;
        this.curDir = 5;
        this.log = el('div', 'panel-out mono');
        this.dirBtns = [];
        store.onChange(() => this.renderResult());
        this.build();
    }
    build() {
        this.root.innerHTML = '';
        this.root.appendChild(el('h3', '', '输入缓冲 / 搓招识别'));
        const bufRow = el('div', 'row');
        bufRow.appendChild(el('span', '', '缓冲帧数: '));
        const buf = el('input', 'cell-input tiny');
        buf.type = 'number';
        buf.value = String(this.store.bufferFrames);
        buf.onchange = () => this.store.update(() => {
            this.store.bufferFrames = Math.max(1, Math.floor(Number(buf.value) || 1));
        }, 'panel');
        bufRow.appendChild(buf);
        bufRow.appendChild(el('span', 'dim', '  (方向指令在此窗口内按子序列匹配)'));
        this.root.appendChild(bufRow);
        // 方向键盘(小键盘布局)
        const pad = el('div', 'dpad');
        const layout = [7, 8, 9, 4, 5, 6, 1, 2, 3];
        for (const d of layout) {
            const b = el('button', 'dir-btn', String(d));
            b.onclick = () => { this.curDir = d; this.pushFrame([]); };
            this.dirBtns.push(b);
            pad.appendChild(b);
        }
        this.root.appendChild(pad);
        const btnRow = el('div', 'row');
        for (const btn of ['P', 'K']) {
            const b = el('button', 'btn', `按 ${btn}`);
            b.onclick = () => this.pushFrame([btn]);
            btnRow.appendChild(b);
        }
        const clear = el('button', 'btn', '清空');
        clear.onclick = () => { this.events = []; this.frame = 0; this.renderResult(); };
        btnRow.appendChild(clear);
        this.root.appendChild(btnRow);
        this.root.appendChild(this.log);
        this.renderResult();
    }
    pushFrame(buttons) {
        this.events.push({ frame: this.frame, dir: this.curDir, buttons });
        this.frame++;
        this.renderResult();
    }
    renderResult() {
        const commands = this.store.char.moves.map((m) => m.command).filter((c) => c);
        const matched = recognizeCommands(this.events, commands, this.store.bufferFrames, this.frame - 1);
        this.log.innerHTML = '';
        const seq = this.events.map((e) => e.dir + (e.buttons.length ? e.buttons.join('') : '')).join(' ');
        this.log.appendChild(el('div', 'dim', `输入序列: ${seq || '(空)'}`));
        this.log.appendChild(el('div', matched.length ? 'good' : 'dim', matched.length ? `识别到:${matched.join('、')}` : '未识别到指令'));
    }
}
// ---------- 4. 连段验证器 ----------
export class ComboPanel {
    constructor(store, root) {
        this.store = store;
        this.root = root;
        this.steps = [];
        this.firstBlocked = false;
        this.listEl = el('div', 'panel-out');
        this.resultEl = el('div', 'panel-out');
        store.onChange(() => this.render());
    }
    render() {
        this.root.innerHTML = '';
        this.root.appendChild(el('h3', '', '连段验证器'));
        const addRow = el('div', 'row');
        const moveSel = el('select');
        for (const m of this.store.char.moves) {
            const o = el('option', '', `${m.name} (${m.id})`);
            o.value = m.id;
            moveSel.appendChild(o);
        }
        const viaSel = el('select');
        viaSel.appendChild(Object.assign(el('option', '', '取消'), { value: 'cancel' }));
        viaSel.appendChild(Object.assign(el('option', '', '目押'), { value: 'link' }));
        const addBtn = el('button', 'btn', '添加一步');
        addBtn.onclick = () => {
            this.steps.push({ moveId: moveSel.value, via: viaSel.value });
            this.refreshList();
        };
        const clearBtn = el('button', 'btn', '清空');
        clearBtn.onclick = () => { this.steps = []; this.refreshList(); };
        const blkLabel = el('label', 'chk');
        const blk = el('input');
        blk.type = 'checkbox';
        blk.onchange = () => { this.firstBlocked = blk.checked; };
        blkLabel.appendChild(blk);
        blkLabel.appendChild(document.createTextNode('第一招被防'));
        addRow.appendChild(moveSel);
        addRow.appendChild(viaSel);
        addRow.appendChild(addBtn);
        addRow.appendChild(clearBtn);
        addRow.appendChild(blkLabel);
        this.root.appendChild(addRow);
        const runBtn = el('button', 'btn primary', '逐帧模拟');
        runBtn.onclick = () => this.run();
        this.root.appendChild(runBtn);
        this.root.appendChild(this.listEl);
        this.root.appendChild(this.resultEl);
        this.refreshList();
    }
    refreshList() {
        this.listEl.innerHTML = '';
        this.listEl.appendChild(el('div', 'dim', this.steps.length
            ? this.steps.map((s, i) => `${i + 1}.${s.moveId}${i ? (s.via === 'cancel' ? '(取消)' : '(目押)') : ''}`).join(' → ')
            : '尚未添加招式'));
        this.resultEl.innerHTML = '';
    }
    run() {
        if (this.steps.length === 0)
            return;
        const r = simulateCombo(this.store.char, this.steps, this.firstBlocked);
        this.resultEl.innerHTML = '';
        const verdictText = {
            TRUE_COMBO: this.firstBlocked ? '无缝压制,对手动不了' : '连段成立,对手防不了',
            BLOCKABLE: '连段会断:对手中间可以防/抢',
            INVALID: '衔接不合法(取消窗口或取消表不满足)',
        }[r.verdict];
        const head = el('div', r.verdict === 'TRUE_COMBO' ? 'good big' : 'bad big', `${r.verdict} — ${verdictText}  总伤害:${r.totalDamage}`);
        this.resultEl.appendChild(head);
        const tbl = el('table', 'data-table');
        const hr = el('tr');
        for (const h of ['招式', '开始帧', '命中帧', '空档', '判定', '说明'])
            hr.appendChild(el('th', '', h));
        tbl.appendChild(hr);
        for (const s of r.steps) {
            const tr = el('tr');
            for (const cell of [s.moveName, String(s.startFrame), String(s.hitFrame), String(s.gap), s.status, s.note]) {
                tr.appendChild(el('td', s.status === 'OK' ? '' : 'bad', cell));
            }
            tbl.appendChild(tr);
        }
        this.resultEl.appendChild(tbl);
    }
}
