# 浏览器验收报告：水滴圆形挡火

验收日期：2026-07-14

## 验收对象

- 地址：`http://127.0.0.1:4173/?scenario=crowd&overlay=fire`
- 场景：`crowd`
- 当前 Codex 浏览器可见视口：829×778
- Canvas 逻辑分辨率：1600×900
- 正常珠数量：8
- 水滴碰撞半径 / 视觉高度：32px / 64px
- 火焰遮挡：热场分辨率精确几何遮罩，半径缩放 0.82，边缘柔化 4px

## 自动检查

- Canvas：`data-pearl-renderer="droplet"`
- Canvas：`data-pearl-radius="32"`
- Canvas：`data-fire-occlusion="precise-geometry"`
- 同一 20px 粗流场格内，圆心位置的火焰透明；圆外角点仍保留超过 60% 的未遮挡火焰
- 900/2400 性能场景：`data-fire-occlusion="flow-grid"`
- `npm run check`：27 个测试文件、294 项测试通过，配置、素材和 production build 通过
- `npm run test:e2e`：Chrome / Edge 共 36 项通过

## 人工视觉检查

- 水滴压住火焰的位置不再出现 20×20 的方形挖空。
- 暗区贴合水滴主体宽度，圆边带轻微过渡，没有扩大成一圈黑色光晕。
- 火焰仍能从水滴之间和两侧通过，绕流、遮蔽与珠后暗区保持可读。
- 正常场景只增加一个复用的 320×180 遮罩；每帧不创建新遮罩数组。

## 正式产物

- PNG：`screenshots/crowd-rounded-occlusion.png`
