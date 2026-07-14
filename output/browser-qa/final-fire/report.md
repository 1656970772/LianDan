# 最终火焰浏览器验收报告

- 验收日期：2026-07-14
- 验收地址：`http://127.0.0.1:4173/?scenario=pillar&overlay=fire`
- 桌面视口：1600 × 900
- 产品问题：0 个
- 控制台错误：0 个
- 页面错误：0 个

## 验收结论

最终火焰展示在本轮范围内通过验收。火焰由连续热场纹理构成，具有亮焰心、橙红外焰和向上的动态摆动；喷口下方不出火，直柱会遮挡火焰并使火流从左右绕开。旧版细竖线、规则点阵和整面过曝亮墙均未出现。

以下交互已在真实浏览器中逐项验证：

- “关闭”会停止火焰，清空火焰帧与粒子元数据。
- “火焰”会恢复动态热场，帧号持续增长，渲染器标识为 `heat-field`。
- “缺口恢复”“珠群阻挡”“直柱绕流”三种场景可正确切换，火焰与障碍遮挡关系正确。
- `prefers-reduced-motion`、覆盖层状态和渲染元数据已由端到端测试覆盖。

## 自动化与性能证据

- 单元、配置、类型与生产构建：`npm run check` 通过，26 个测试文件、290 个测试全部通过。
- 端到端：Chrome 与 Edge 共 34/34 通过。
- 正式性能门禁：900 珠和 2400 珠均通过，60 秒采样期间均为 0 丢 Tick。
- 正式性能报告：`output/performance/m1/2026-07-14T10-48-27-439Z/summary.md`

## 产物

- 最终直柱截图：`output/browser-qa/final-fire/screenshots/pillar-fire-final-pass-1600x900.png`
- 缺口截图：`output/browser-qa/final-fire/screenshots/gap-fire-1600x900.png`
- 珠群截图：`output/browser-qa/final-fire/screenshots/crowd-fire-1600x900.png`

## 工具与流程备注

- 本机缺少 ffmpeg，浏览器录屏停止阶段失败；未将无效视频作为产品验收产物。
- headed 性能门禁与另一个浏览器自动化会话并发时，桌面点击曾串入采样窗口；关闭项目验收会话并独占运行后，两档正式门禁均通过。
- 一次本地 headed probe 受 HTTP 代理影响返回 503，临时通过 `NO_PROXY=127.0.0.1,localhost` 规避。
