# HimaHarness 中文全景演示包

这套材料展示 HimaHarness 的产品设计、统一工作区、Campaign 控制、两个 Pack，以及真实试验留下的
结果与边界。它用于产品介绍和文字材料配图，不替代一次新的产品验收。

## 交付件

- `HimaHarness-full-demo.zh-CN.mp4`：1920×1080 中文配音成片，画面内含中文字幕。
- `HimaHarness-full-demo.zh-CN.srt`：同时间轴独立字幕。
- `screenshots/`：十张来自真实 Electron 窗口测试的关键功能截图，可直接用于文档。
- `frames/`：视频逐场景的 1920×1080 静帧，也可作为演示文稿插图。
- `manifest.json`：场景、Pack 身份、截图来源和视频参数。
- `SHA256SUMS.txt`：所有交付文件的完整性清单。
- `build_demo.py`：可重复构建脚本。

## 真实性边界

1. UI 截图来自仓库中已保留的 L3 Electron/Catsights 验证产物，来源写在 `manifest.json`。
   成片对应的桌面基线为 HimaHarness `0.3.0-trial.16`。
2. 中文对话是**演示脚本**，叠加在真实产品界面上；它准确描述当前产品合同，但不是一次新的模型调用。
3. DTCO 数字来自 2026-09-21 Trial 24：研究跨七代推进 Cell Demand，但最终 matched Fmax 为
   `-2.93%`，没有把负结果写成成功。
4. Timing Closure 曲线来自 Trial 30 已保留的 baseline 至 generation 8：closure score
   `243.58 → 175.62`。这证明连续 best-database retention 和整体改善，不表示 setup/hold 已 clean。
5. 成片制作期间 Trial 30 已按用户要求进入安全暂停流程；没有为了拍片重新启动 EDA 作业。

## 推荐展示顺序

1. 播放完整视频，建立产品心智模型。
2. 用 `03-dtco-full-graph.png` 说明复杂方法如何被 Pack 和 Fabric 承载。
3. 用 `04-node-detail.png`、`05-pause-control.png` 说明可检查、可干预和可恢复。
4. 用 `frames/15-15-dtco-result.png` 说明 Harness 记录负结果并推动下一代，而不是包装结果。
5. 用 `frames/19-19-xtop-result.png` 说明 XTop Timing Closure 的连续商业工具闭环。
6. 用 `10-knowledge-archive.png` 收束到知识资产与下一轮复用。

## 重新构建

需要 macOS 自带中文语音 `Tingting`、Python 3、Pillow 和 FFmpeg：

```bash
python3 docs/product-demo/2026-09-22-himaharness-full-demo/build_demo.py
```

脚本只读取版本化截图和已确认的试验数字；不会启动 HimaHarness、模型或 EDA 工具。
