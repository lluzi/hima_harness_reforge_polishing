---
status: accepted
---

# Data Insight 内嵌 LibInsight 自有页面

用户于 2026-10-05 明确：内置 Data Insight 直接呈现 LibInsight（`/Users/lluzi/code/lib_insight`）的全部数据页面，
不再另开独立网页；LibInsight 仍在自己的仓库升级，HimaHarness 只在其完成后小幅更新所用版本。

决定：

- Data Insight 默认打开 LibInsight 页面。Host 拥有一个本地 LibInsight viewer 进程：用 LibInsight 自带的
  `app/server.py` 在 `127.0.0.1` 的空闲端口（优先沿用上次端口，以保留 LibInsight 自己保存的 Kit/Variant/Corner
  选择）上服务用户选择的数据文件夹（含 `app.json`），Workbench 用 iframe 原样呈现。Host 关闭时停止该进程。
- 所用 LibInsight 版本由 `packages/desktop/libinsight.pin.json` 固定为一个 commit。打包时
  `--libinsight-source <lib_insight checkout>` 只复制该 commit 的 `app/` 与 `libinsight/`，记录每个文件的 hash，
  `--verify` 复核。升级 LibInsight 只需更新 commit 并重新打包；源码运行用 `HIMA_LIBINSIGHT_ROOT` 指向 checkout。
- 原有已保存报告（Experience、Library Insight report、generation feedback）入口保留为 Data Insight 的
  “Retained reports”。
- LibInsight 继续拥有自己的页面、计算和数据文件夹；HimaHarness 不读取、不改写其数据，也不把其页面重画为
  React 组件。这修正产品定义中“原型只读、仅作功能参考”的集成方式，但不改变 ADR-0012/0013 的三类分析与
  同级工作模式。

边界与已知限制：

- viewer 子进程只获得 `PATH`、`HOME`、`LANG`、`TMPDIR` 等最小环境，不继承模型凭据；不写 Python 字节码。
- 需要本机 Python ≥ 3.9 与 numpy（默认 `python3`，可用 `HIMA_LIBINSIGHT_PYTHON` 指定）。
- LibInsight 的 Analysis runs 页面在其进程内运行本地分阶段分析，它们不是 HimaHarness Run，不进入 Ledger/DBOS。
- Guide 尚不能读取 iframe 内当前选中的 cell、图表或 finding；AI 联动需要 LibInsight 提供受控的选择/上下文接口后再接入。

验证（2026-10-05）：

- L2 `test/contract/libinsight-viewer.test.ts`：启动/复用/重启后沿用文件夹与端口、无凭据环境、失败输出、
  进程意外退出、并发打开只起一个进程、启动中停止不留进程。
- L3 `test/contract/unified-workbench.test.ts`（Catsights）：iframe 自身文档渲染、Host cookie 不到达 viewer、
  切换 Campaign 后不重载、Retained reports 往返、选择器无结果时可输入路径并切换数据文件夹。
- 打包 App（trial.38 发现选择器返回空时按钮无反应，trial.39 修复）：真实 `lib_insight/data`（TSMC28 180a 等）
  的 Health/Overall map、Capability、Working range heatmap 在 Data Insight 内呈现，退出 App 后 viewer 进程随之结束。
  截图在 `.hima-tmp/libinsight-embed/kit-li-*/screenshots/`（不入 Git）。
