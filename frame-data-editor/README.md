# 帧数据编辑器(Frame Data Editor)

2D 格斗游戏的网页帧数据编辑器,TypeScript 实现,零运行时依赖。

## 运行

```bash
npm install
npm run build     # 编译 TS → dist/
npm run serve     # 打开 http://localhost:8080
```

## 测试(10 个已知结果的连段用例)

```bash
npm test          # 编译并运行 tests/run.ts,10/10 通过
```

## 功能对照

| 需求 | 实现 |
|---|---|
| 时间轴三段相位 | `src/editor.ts` 时间轴:发生(黄)/持续(红)/收招(蓝),逐帧缩略图 |
| 判定框编辑 + 朝向翻转 | 画布拖拽画框,框按朝右存储、渲染时镜像(`facing`) |
| 有利/不利帧 | `src/frameMath.ts` `advantageOnHit/OnBlock` + 确反判定 |
| 取消窗口 / 取消表 | `cancelWindow` + `cancelInto`,取消设置面板可视化编辑 |
| 输入缓冲 + 搓招 | `src/input.ts`,缓冲帧数可配,方向序列子序列匹配(如 236P) |
| 连段验证器 | `src/combo.ts` `simulateCombo`,逐帧模拟,判定 TRUE_COMBO / BLOCKABLE / INVALID |
| 数据表双向同步 | `src/store.ts` 单一数据源,表格 ↔ 编辑器互相重绘 |

## 验证器规则

- 命中帧 = 招式开始帧 + 发生帧;硬直结束后下一帧对手才可行动
- 空档 gap = 下一招命中帧 − (硬直结束帧 + 1);gap ≥ 1 → 对手可防
- 取消:必须在取消窗口内且目标招在 `cancelInto` 表内;目押:等上一招全部帧走完
- 第一招可选"被防",此时验证的是压制是否无缝(对手全程防御硬直)

## 目录

```
src/types.ts      数据模型(判定框以脚底为原点,朝右存储)
src/data.ts       示例角色"阿岚"(5A/5B/5C/236A/236B/236236A)
src/frameMath.ts  相位、有利帧、确反
src/input.ts      输入缓冲、指令识别
src/combo.ts      连段验证器
src/store.ts      状态 + 订阅
src/editor.ts     画布 + 时间轴
src/table.ts      数据表
src/panels.ts     四个功能面板
tests/run.ts      10 个连段用例
```
