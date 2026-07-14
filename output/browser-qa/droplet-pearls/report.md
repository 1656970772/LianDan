# 浏览器验收报告：64px 水滴珠

验收日期：2026-07-14

## 验收对象

- 地址：`http://127.0.0.1:4173/?scenario=crowd&overlay=fire`
- 场景：`crowd`
- 视口 / Canvas / DPR：1600×900 / 1600×900 / 1
- 浏览器：Chrome 150
- 正常珠数量：8
- 流场碰撞半径：32px
- 视觉外形：64px 高水滴轮廓

## 自动检查

- Canvas：`data-pearl-renderer="droplet"`
- Canvas：`data-pearl-radius="32"`
- 场景：`data-scenario-id="crowd"`
- 火焰：`data-fire-state="animated"`
- 页面错误：0
- 控制台消息：0
- `npm run check`：27 个测试文件、294 项测试通过，配置、素材和 production build 通过
- `npm run test:e2e`：Chrome / Edge 共 36 项通过

## 人工视觉检查

- 8 颗正常珠均显示尖顶、圆底的水滴剪影，左上高光能帮助识别体积。
- 水滴高度从上一版 96px 降为 64px，即缩小三分之一。
- 珠子数量未增加，400×280 生成区中的圆形碰撞代理名义占位率约为 23%。
- 火焰继续从珠子之间和两侧通过，珠后暗区仍可见。
- 900/2400 性能场景仍使用半径 6px / 4px 的小圆代理，不执行水滴曲线绘制。

## 正式产物

- PNG：`screenshots/crowd-droplet-pearls-1600x900.png`
