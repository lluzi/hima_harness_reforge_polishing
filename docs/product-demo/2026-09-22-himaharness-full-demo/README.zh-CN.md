# HimaHarness 中文全景演示包

这套材料展示 HimaHarness 的产品设计、统一工作区、Campaign 控制、两个 Pack，以及真实试验留下的
结果与边界。主交付是一段由 Codex Computer Use 实际操作 HimaHarness 形成的桌面录屏；讲解型视频
只作为补充材料。

## 主交付：真人式操作录屏

- `HimaHarness-human-screen-demo.zh-CN.mp4`：15 分 18 秒、1920×1200。画面全部来自真实
  HimaHarness 窗口、真实点击、中文输入、DeepSeek-V4.1-Flash 响应和已保留的 Campaign 数据；
  MP4 内含可开关的中文字幕轨。
- `HimaHarness-human-screen-demo.zh-CN.srt`：独立中文字幕。
- `screen-recording/`：从原始录屏直接提取的二十四张关键功能截图。
- `screen-demo-manifest.json`：录制环境、剪辑区间、截图原始时间点和真实性边界。

录屏包含：应用启动、新会话、中文产品问答、Campaign 配置、Site 绑定、完整 Fabric 图、九代
Generations、Evidence/endpoint 指标、Pack & assets、DTCO 5.2.10 文件读取与中文解释、Files & code、
DTCO 与 XTop 两套 Pack 的源码浏览。新增的 Live Run 深挖段真实演示全图适配、放大、缩小、鼠标
拖拽平移、定位当前节点，并打开 `plan-fix`、`apply-eco`、`evidence-gate`。观众可以看到：

- `Facts`：节点声明的输入以及归属；
- `Job`：每代实际作业、执行 ID、时间、退出码与商业工具席位；
- `Code`：实际执行的脚本、语言、大小和 SHA256；
- `Knowledge`：每代分别保留的 `closureState` 与 `closureExperience`；
- `Rules` / `Verdicts`：固定判据及其逐代 PASS/FAIL、WNS/TNS、违例和 endpoint 变化；
- `Evidence`：结果文件路径、文件哈希、reader 脚本和读取时间构成的来源链。

双 Pack 对照段进一步打开并滚动两份真实 `graph.yml`，展示 HimaHarness 如何用同一机制承载两类
完全不同的业务：

- DTCO Pack 从输入绑定和六个并行 miner 出发，经 AI Workshop、F0–F3、Cell 生成、Layout、
  Characterization、Liberty 校准、累计 Library、双臂综合、匹配 P&R 和 E0 反馈形成研究闭环；
- Timing Closure Pack 从只读 Innovus checkpoint 出发，经基线提取、plan-fix、XTop、Innovus ECO、
  StarRC、PrimeTime、best-database retention 和 endpoint 反馈形成物理 ECO 闭环；
- 两者都使用 `act`、`read`、`judge`、`explore`、`wait`，并由 Pack 内的 Intent、Graph、Contract、
  Tools、Readers、Rules、Choosers、Knowledge、预算和证据语义定义完整方法；
- HimaGuide 在一个新中文会话中实际读取四份 Pack 文件并解释上述关系，随后回到 Pack 配置和真实
  Live Run，展示声明式方法如何被 Fabric 投影为可观察的运行图。

版本边界：Desktop App 的 Files 面板连接到冻结的 `hima_harness_agent_trial_fix_v27` 工作区，因此
源码浏览画面中的 XTop 图标记为 `1.0.2`；随后 HimaGuide 按绝对路径读取当前 polishing 仓库的
`1.0.5`，Campaign 配置也显示编译后的 `1.0.5`。两者核心 28 节点拓扑一致，后续版本增加的是经过
试验验证的工具边界和 route-preservation 修正。视频没有把历史工作区源码冒充为当前发布版本。

录制期间 Trial 30 保持 Run-wide pause，没有启动新 Campaign 或 EDA Job。

## 补充交付：讲解型视频

- `HimaHarness-full-demo.zh-CN.mp4`：1920×1080 中文配音讲解片，画面内含中文字幕。
- `HimaHarness-full-demo.zh-CN.srt`：同时间轴独立字幕。
- `screenshots/`：十张来自真实 Electron 窗口测试的关键功能截图，可直接用于文档。
- `frames/`：视频逐场景的 1920×1080 静帧，也可作为演示文稿插图。
- `manifest.json`：场景、Pack 身份、截图来源和视频参数。
- `SHA256SUMS.txt`：所有交付文件的完整性清单。
- `build_demo.py`：可重复构建脚本。

## 真实性边界

1. 主录屏是在 Catsights（macOS display 3）上通过 Computer Use 实际操作产生的，未插入任何
   presentation 页面；后期只删除等待和一次无效的宽泛搜索。
2. 主录屏中的中文对话、工具调用、失败提示、文件读取和响应均由真实 HimaHarness 会话产生。
3. `screen-recording/` 截图来自三段原始录屏帧；三段 MOV 均保留在本地
   `.hima-tmp/demo-recording/`，不进入 Git。版本化 MP4 是删除等待后串接形成的可交付剪辑。
4. 补充讲解片的 UI 截图来自仓库中已保留的 L3 Electron/Catsights 验证产物，来源写在
   `manifest.json`。
   两套视频对应的桌面基线均为 HimaHarness `0.3.0-trial.16`。
5. 补充讲解片中的中文对话是**演示脚本**；主录屏中的中文对话是真实模型调用。
6. DTCO 数字来自 2026-09-21 Trial 24：研究跨七代推进 Cell Demand，但最终 matched Fmax 为
   `-2.93%`，没有把负结果写成成功。
7. Timing Closure 曲线来自 Trial 30 已保留的 baseline 至 generation 8：closure score
   `243.58 → 175.62`。这证明连续 best-database retention 和整体改善，不表示 setup/hold 已 clean。
8. 主录屏时 Trial 30 的最终控制状态为 `control.paused=['*']`；150 个 Job 全部完成、无 open Job。

## 推荐展示顺序

1. 播放完整视频，建立产品心智模型。
2. 用 `screen-recording/11-live-graph-fit.png` 与 `12-live-graph-zoom-pan.png` 说明复杂方法如何被
   Pack 和 Fabric 承载，并可在全局与局部之间导航。
3. 用 `13-plan-fix-code.png`、`14-apply-eco-job.png` 说明代码身份与真实商业作业如何进入同一张图。
4. 用 `15-evidence-gate-verdicts.png`、`16-evidence-provenance.png` 说明裁决结果与来源证据可追溯。
5. 用 `17-dtco-parallel-miners.png`、`18-dtco-commercial-feedback.png` 展示 DTCO 的研究、Cell 实现和
   商业反馈节点；用 `19-xtop-closure-nodes.png`、`20-xtop-iteration-edges.png` 展示 Timing Closure
   的工具闭环与迭代边。
6. 用 `21-pack-capabilities-explanation.png`、`22-shared-node-semantics.png` 说明 Pack 可封装的能力与
   两套业务共用的节点语义。
7. 用 `23-pack-config-contract.png`、`24-pack-to-live-run.png` 说明 Pack 声明如何经过 Site、Goal、预算
   和 Knowledge 绑定，最终变成 Fabric Live Run。
8. 用 `04-node-detail.png`、`05-pause-control.png` 说明可检查、可干预和可恢复。
9. 用 `frames/15-15-dtco-result.png` 说明 Harness 记录负结果并推动下一代，而不是包装结果。
10. 用 `frames/19-19-xtop-result.png` 说明 XTop Timing Closure 的连续商业工具闭环。
11. 用 `10-knowledge-archive.png` 收束到知识资产与下一轮复用。

## 重新构建

需要 macOS 自带中文语音 `Tingting`、Python 3、Pillow 和 FFmpeg：

```bash
python3 docs/product-demo/2026-09-22-himaharness-full-demo/build_demo.py
```

脚本只读取版本化截图和已确认的试验数字；不会启动 HimaHarness、模型或 EDA 工具。
