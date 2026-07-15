# M2 生产浏览器验收报告

- 初次验收日期：2026-07-14
- 快速出火复核日期：2026-07-15
- 工具：agent-browser 0.30.1、项目 Playwright、production `vite preview`
- 页面：`http://127.0.0.1:4199/`（验收时使用的本地地址）

## 验收结果

- 默认页面进入 `m2-extraction`，内容指纹为 `c88cbe47e928f439419a0faeb616da82db7a7da45c77d909c4d7d473459d98e2`。
- 初始火力为 32，唯一火种不自动装备；人工选择火种、投入青岚草后进入 extracting。
- 以火力 20 验证中心局部溶解：剩余材料体积 5.38、活动珠 2，画面可见动态缺口和两颗药液珠。
- 把容器对齐材料后继续完成萃取，最终剩余材料 0、活动珠 0、已接取 8、`canFinish=true`。
- 点击结束后进入 completed，完成弹板显示“已接取 8 颗精灵珠”。
- 1920×1080 和 1366×768 画面无裁切。950×700 时 `overflow-y:auto`、文档高度 1170；滚动到 `scrollY=470` 后结束按钮位于视口 `591.55～631.55`。
- 整个流程 console 输出为空，page errors 为空。
- 快速出火复核在按下后依次捕获 `emerging` 前沿 `218.4px`、`emerging` 前沿 `508.8px`、`animated` 全路径三个状态；火焰从底部喷口快速伸向药材，不再首帧整条出现。
- 松开后状态回到 `off` 且清除前沿元数据；再次按下重新进入 `emerging`。低动态模式直接显示稳定静态火焰。
- 全量 Vitest 为 413/413，Chrome / Edge E2E 为 70/70。

## 正式 PNG 证据

- [`m2-workbench-1920x1080.png`](./m2-workbench-1920x1080.png)：初始玩家工作台。
- [`m2-loaded-1920x1080.png`](./m2-loaded-1920x1080.png)：材料投入且容器对齐。
- [`m2-extracting-20-1920x1080.png`](./m2-extracting-20-1920x1080.png)：局部溶解、动态缺口与活动珠。
- [`m2-completed-1920x1080.png`](./m2-completed-1920x1080.png)：桌面完成弹板。
- [`m2-completed-1366x768.png`](./m2-completed-1366x768.png)：1366×768 完成弹板。
- [`m2-narrow-950x700.png`](./m2-narrow-950x700.png)：950×700 窄屏起始布局。
- [`m2-fire-emerging-1366x768.png`](./m2-fire-emerging-1366x768.png)：玩家工作台中的快速出火阶段。
- [`m2-fire-steady-1366x768.png`](./m2-fire-steady-1366x768.png)：玩家工作台中的稳定火流阶段。
- [`m2-fire-startup-comparison.png`](./m2-fire-startup-comparison.png)：左侧快速出火、右侧稳定火流的同尺寸对比。

验收采用 production `vite preview`；可复核证据以本报告记录的状态数据、正式 PNG 和自动化测试结果为准。
