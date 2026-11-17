// 入口:装配各模块。

import { createSampleCharacter } from './data.js';
import { Store } from './store.js';
import { BoxEditor } from './editor.js';
import { DataTable } from './table.js';
import { AdvantagePanel, CancelPanel, InputPanel, ComboPanel } from './panels.js';

const store = new Store(createSampleCharacter());

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// 招式列表(侧栏)
const moveList = $('move-list');
function renderMoveList(): void {
  moveList.innerHTML = '';
  for (const m of store.char.moves) {
    const li = document.createElement('li');
    li.textContent = `${m.name} ${m.command ? `[${m.command}]` : ''}`;
    li.className = m.id === store.selectedMoveId ? 'selected' : '';
    li.onclick = () => store.selectMove(m.id);
    moveList.appendChild(li);
  }
}
store.onChange(() => renderMoveList());

// 编辑模式与朝向
const editor = new BoxEditor(store, $('stage') as HTMLCanvasElement, $('timeline') as HTMLCanvasElement);
for (const [id, mode] of [['mode-select', 'select'], ['mode-hit', 'hit'], ['mode-hurt', 'hurt']] as const) {
  $(id).onclick = () => {
    editor.mode = mode;
    for (const [oid] of [['mode-select'], ['mode-hit'], ['mode-hurt']]) $(oid).classList.toggle('active', oid === id);
    editor.render();
  };
}
$('flip').onclick = () => store.update(() => { store.facing = store.facing === 1 ? -1 : 1; }, 'panel');

// 数据表与面板
const table = new DataTable(store, $('table-root'));
new AdvantagePanel(store, $('panel-advantage'));
new CancelPanel(store, $('panel-cancel'));
new InputPanel(store, $('panel-input'));
new ComboPanel(store, $('panel-combo'));

// 页签
for (const tab of document.querySelectorAll<HTMLElement>('.tab')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('.tab')) t.classList.remove('active');
    for (const p of document.querySelectorAll('.tab-page')) p.classList.remove('active');
    tab.classList.add('active');
    $(tab.dataset.page!).classList.add('active');
  };
}

// 导出 / 导入 JSON
$('export').onclick = () => {
  ($('json-io') as HTMLTextAreaElement).value = JSON.stringify(store.char, null, 2);
};
$('import').onclick = () => {
  try {
    const data = JSON.parse(($('json-io') as HTMLTextAreaElement).value);
    store.update(() => {
      store.char = data;
      store.selectedMoveId = data.moves[0].id;
      store.selectedFrame = 0;
    }, 'panel');
  } catch (e) {
    alert('JSON 解析失败: ' + e);
  }
};

// 首帧渲染
renderMoveList();
table.render();
editor.render();
