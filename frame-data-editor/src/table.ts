// 数据表:与编辑器双向同步。表格改 → store 通知编辑器重绘;
// 编辑器改 → store 通知表格重绘(来源是表格自己时跳过,避免输入中丢焦点)。

import { Move, totalFrames } from './types.js';
import { advantageOnHit, advantageOnBlock } from './frameMath.js';
import { Store } from './store.js';

type NumField = 'startup' | 'active' | 'recovery' | 'damage' | 'hitstun' | 'blockstun';

const NUM_COLS: { key: NumField; label: string }[] = [
  { key: 'startup', label: '发生' },
  { key: 'active', label: '持续' },
  { key: 'recovery', label: '收招' },
  { key: 'damage', label: '伤害' },
  { key: 'hitstun', label: '命中硬直' },
  { key: 'blockstun', label: '防御硬直' },
];

export class DataTable {
  constructor(private store: Store, private root: HTMLElement) {
    store.onChange((src) => { if (src !== 'table') this.render(); });
  }

  private numCell(m: Move, key: NumField): HTMLTableCellElement {
    const td = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.value = String(m[key]);
    input.className = 'cell-input';
    input.onchange = () => {
      const v = Math.max(0, Math.floor(Number(input.value) || 0));
      this.store.update(() => {
        m[key] = v;
        // 帧数变了,逐帧判定框数组跟着伸缩
        const total = totalFrames(m);
        while (m.frames.length < total) {
          m.frames.push({ hit: [], hurt: m.frames.length ? [...m.frames[m.frames.length - 1].hurt.map(b => ({ ...b }))] : [] });
        }
        m.frames.length = total;
      }, 'table');
    };
    td.appendChild(input);
    return td;
  }

  render(): void {
    this.root.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'data-table';
    const head = document.createElement('tr');
    for (const label of ['招式', '指令', ...NUM_COLS.map(c => c.label), '总帧数', '命中有利', '被防有利', '取消窗口', '可取消成']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    }
    table.appendChild(head);

    for (const m of this.store.char.moves) {
      const tr = document.createElement('tr');
      if (m.id === this.store.selectedMoveId) tr.className = 'row-selected';
      tr.onclick = () => this.store.selectMove(m.id);

      const name = document.createElement('td');
      name.textContent = `${m.name} (${m.id})`;
      tr.appendChild(name);

      const cmd = document.createElement('td');
      const cmdInput = document.createElement('input');
      cmdInput.value = m.command;
      cmdInput.className = 'cell-input cmd';
      cmdInput.onchange = () => this.store.update(() => { m.command = cmdInput.value.trim(); }, 'table');
      cmdInput.onclick = (e) => e.stopPropagation();
      cmd.appendChild(cmdInput);
      tr.appendChild(cmd);

      for (const col of NUM_COLS) {
        const td = this.numCell(m, col.key);
        td.onclick = (e) => e.stopPropagation();
        tr.appendChild(td);
      }

      const total = document.createElement('td');
      total.textContent = String(totalFrames(m));
      tr.appendChild(total);

      const advH = document.createElement('td');
      const ah = advantageOnHit(m);
      advH.textContent = (ah >= 0 ? '+' : '') + ah;
      advH.className = ah >= 0 ? 'adv-pos' : 'adv-neg';
      tr.appendChild(advH);

      const advB = document.createElement('td');
      const ab = advantageOnBlock(m);
      advB.textContent = (ab >= 0 ? '+' : '') + ab;
      advB.className = ab >= 0 ? 'adv-pos' : 'adv-neg';
      tr.appendChild(advB);

      const win = document.createElement('td');
      if (m.cancelWindow) {
        const mk = (val: number, set: (v: number) => void) => {
          const i = document.createElement('input');
          i.type = 'number'; i.value = String(val); i.className = 'cell-input tiny';
          i.onchange = () => this.store.update(() => set(Math.max(0, Math.floor(Number(i.value) || 0))), 'table');
          i.onclick = (e) => e.stopPropagation();
          return i;
        };
        win.appendChild(mk(m.cancelWindow.start, (v) => { m.cancelWindow!.start = v; }));
        win.appendChild(document.createTextNode(' - '));
        win.appendChild(mk(m.cancelWindow.end, (v) => { m.cancelWindow!.end = v; }));
      } else {
        win.textContent = '—';
      }
      tr.appendChild(win);

      const into = document.createElement('td');
      into.textContent = m.cancelInto.length ? m.cancelInto.join(', ') : '—';
      tr.appendChild(into);

      table.appendChild(tr);
    }
    this.root.appendChild(table);
  }
}
