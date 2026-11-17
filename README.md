# 调色板动画编辑器 (Palette Cycle Editor)

复古像素游戏的调色板循环动画工具:图不用改,只让调色板里的颜色轮转/往复/渐变,
瀑布、火焰、霓虹灯就动起来了。TypeScript 编写,Canvas 渲染,无框架依赖。

## 运行

```bash
npm install        # 仅 typescript 一个依赖
npm run build      # 编译 TS → dist/
npm run serve      # 打开 http://localhost:8080
npm test           # 编译 + 运行 Node 测试(动画算法/GIF LZW/PNG 解析/量化)
```

打开页面即是内置演示图(320×200,瀑布/火焰/霓虹/灯带/星空/岩浆 6 个循环组),
左上角有实时帧率。

## 功能

- **导入图片**:索引色 PNG 直接解析 PLTE/IDAT,**保留原图色号顺序**(框选连续色号不错位);
  其他图片自动量化到 256 色(≤256 色时精确保留)
- **循环组**:在调色板上拖动框选连续色号 →「用选区新建循环组」;每组可设
  - 模式:**轮转**(单向循环)/ **往复**(来回)/ **渐变**(RGB 连续插值,霓虹呼吸感)
  - 速度(色格/秒,可小数)、方向(→/←)、启用开关;多组同时运行,范围可重叠(后面的组覆盖)
- **画画**:画笔 / 油漆桶 / 吸管(右键随时取色),画笔只能选调色板里的颜色;
  Ctrl+Z 撤销,`[` `]` 切换色号,B/F/I/G 快捷键,空格拖动平移,滚轮整数倍缩放
- **预览**:整数倍最近邻放大(`imageSmoothingEnabled = false`),绝不模糊;
  320×200 + 10 组实测每帧 0.06ms,60fps 无压力
- **导出**:
  - **数据 JSON** — 给游戏程序的调色板动画数据(格式见下)
  - **GIF** — 利用"像素不变、只换调色板"的特性,每帧只写局部调色板,LZW 只压缩一次,
    80 帧约 12ms 导完;时长默认自动算所有组的最小公倍循环
  - **当前帧 PNG**、**工程文件**(含像素,可完整保存/恢复)

## 数据 JSON 格式(给游戏程序)

```json
{
  "format": "palette-cycle-anim",
  "version": 1,
  "width": 320,
  "height": 200,
  "palette": ["#0a0c22", "..."],
  "groups": [
    { "name": "瀑布", "start": 32, "end": 47, "mode": "cycle", "speed": 8, "direction": 1, "enabled": true }
  ],
  "pixels": { "encoding": "base64", "data": "..." }
}
```

- `start`/`end` 为闭区间色号;`speed` 单位是色格/秒;`direction` 为 1 或 -1
- `mode`:`cycle` 轮转 | `pingpong` 往复 | `lerp` 渐变插值
- `pixels` 可选(导出时勾选),每字节一个色号,按行优先

## 游戏运行时算法(每帧)

直接参考 `src/anim.ts` 的 `applyGroups`(纯函数,可整文件抄走):

```
palette = basePalette.slice()
for group in groups:                       # 按数组顺序,后者覆盖前者
  n = group.end - group.start + 1
  if mode == cycle:    off = floor(speed * t * dir) mod n
  if mode == pingpong: off = triangle(floor(speed * t * dir), 周期 2n-2)
  if mode == lerp:     phase = (speed * t * dir) mod n        # 浮点
  # 离散模式:槽位 i 的颜色 = 源槽位 (i + off) mod n
  # lerp:槽位 i 的颜色 = lerp(源槽位 (i+⌊phase⌋) mod n, 源槽位 (i+⌊phase⌋+1) mod n, frac(phase))
for each pixel: rgb = palette[index[pixel]]
```

## 项目结构

```
src/anim.ts        动画核心算法(纯函数,游戏运行时可复用)
src/gifenc.ts      GIF89a 编码器(LZW + 每帧局部调色板)
src/pngindexed.ts  索引色 PNG 解析(保留色号顺序)
src/imageio.ts     图片导入 / 256 色量化 / 默认调色板
src/demo.ts        内置演示图
src/exporter.ts    数据 JSON / 工程 / GIF 导出
src/main.ts        编辑器 UI、渲染循环、绘画工具
test/run-tests.mjs 34 项 Node 测试
```
