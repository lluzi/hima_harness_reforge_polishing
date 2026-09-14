# 评估环境交接参考

配套《HimaHarness 使用评估手册》1.0。管理员填写后交给评估者。公开模板只写字段和检查方法，不包含可复制到任意客户现场的真实配置，也不交付模型密钥或许可证。

## 一、最小交接卡

| 字段 | 实际值 / 状态（由管理员填写） |
| --- | --- |
| 应用版本、来源和源提交 | |
| ZIP / 清单校验结果 | |
| 支持的操作系统、CPU 架构 | |
| 启动器位置、使用步骤 | |
| 是否依赖特定显示器；名称 | |
| 本地测试工作区 | |
| 实际 DSH_HOME / HIMA_USER_DATA（或安全代号） | |
| 凭据由谁提供、如何进入进程（不填值） | |
| 模型服务与可发送的数据范围；相关数据政策是否确认 | |
| 普通编码依赖与已验证的小任务 | |
| 路线 A / B / C 分别是否准备好 | |
| 可读的 Pack / 版本 / digest | |
| 可用 Site / 连接方式 / 负责人 | |
| 来源 Run ID 与阅读入口 | |
| 来源 manifest.json 的精确本地路径 | |
| 来源 experience.md 的精确本地路径 | |
| 来源 manifest SHA-256 | |
| 五分钟历史 study 的 Goal、策略与入口节点 | |
| 允许发生的 Site 文件 I/O | |
| 真实 EDA 是否允许；批准人及预算 | |
| 报告与反馈交付位置、分享范围 | |
| 故障联系人、可用时间、回滚/备份位置 | |

交付检查：不同用户不要共享仍在写入的 Home；原始凭据不写进此表；历史素材与许可证的分享权限单独确认。仅有 `.app` 不能证明 B/C 路线已经就绪。

## 二、站点准备的边界

Site 声明、Permit 和 Pack 的私有输入需一致。`flowRoot` 是准备好的方法和输入目录；`workspaceRoot` 是新 Campaign 的写入位置。参考输入与每次运行的副本分开。先验证连接、路径、实际工具版本、许可证和最小操作，再授权完整 Campaign。

不要照搬仓库历史 `sites/linglong-aes/site.yml`：其路径与容量可能属于早期 probe。最后正式 pilot 在自己的 Home 内安装了匹配的 Site，包含 DC、LC、Innovus 三类许可与受控并发。公开目录名不是可用环境的证明。

这份手册不提供“一键安装商业 EDA / PDK / 学习模型”。新 Site 的适配由 CAD/EDA 与产品负责人完成，不应让无背景的评估者猜路径或放宽 Permit。

## 三、AES Pack 5 的私有 inputs.json 字段清单

下表是已用 pilot 输入的**字段名盘点**，不是默认值表，也不意味着每个用户必须逐字使用同一个路径。权威约束和引用关系在固定版本的 `contract.yml`、`SPEC.md`、`flow/probe.py`、`flow/stages.py` 及 `flow/README.md` 中。实际可用性仍由准备检查和运行验证确定。

顶层字段：`evidenceClass`、`design`、`rtlGlob`、`foundryDb`、`edaWrapper`、`legacy`、`bindingProvenance`。真实研究使用 `site-run`；测试替身不得通过修改标签升级为真实证据。`bindingProvenance` 保留输入绑定来源。

| legacy 分组 | 字段名 |
| --- | --- |
| 设计与工艺库 | DESIGN_TOP, DESIGN_RTL_GLOB, FOUNDRY_LIB, FOUNDRY_LEF, FOUNDRY_TECH_LEF, FOUNDRY_QRC_TECH, FOUNDRY_DB, FOUNDRY_GDS, LIBERTY_SKELETON, TECH_LEF |
| 布局/生成工具 | LIBRECELL_TECH_PY, BOOL2CMOS_PDK_PROFILE, GEOMETRY_RULE_DECK, XS28_GDS_MAP, XS28_POWER_TEMPLATE_BASE_CELL, BOOL2CMOS_CMD, BOOL2CMOS_CWD, XS28_LCLAYOUT_ACTIVATE |
| 容器 | XS28_CONTAINER_RUNTIME, XS28_CONTAINER_IMAGE, XS28_CONTAINER_HOST_ROOT, XS28_CONTAINER_MOUNT_POINT |
| 表征与预测 | CHARMODEL_TIMING_MODEL, CHARMODEL_POWER_MODEL, CHARMODEL_AREA_MODEL, XS28_CHARMODEL_HELPER_DIR, CHARACTERIZATION_PROFILE_REF |
| 供电、物理与分析 | XS28_POWER_PIN, XS28_GROUND_PIN, XS28_TAP_CELL, XS28_FILLER_CELLS, XS28_PROCESS_NODE, XS28_TAP_INTERVAL, XS28_MAX_ROUTE_LAYER, XS28_RC_TEMPERATURE, XS28_SWITCHING_ACTIVITY |
| 候选与库规格 | MAX_CELLS, MAX_ROUTE_CANDIDATES, PROCESS_FAMILY, CELL_ARCHITECTURE_REF, DRIVE_STRENGTH, VT_CLASS, GENERATED_LIBRARY_NAME, GENERATED_LIB_CELL_PATTERN |
| 时钟与资源 | CLOCK_NS, MULTI_CPU |
| 超时和验证限额 | GENERATION_TIMEOUT_SEC, ABSTRACT_TIMEOUT_SEC, CHARACTERIZE_TIMEOUT_SEC, LC_TIMEOUT_SEC, SYNTH_TIMEOUT_SEC, PNR_TIMEOUT_SEC, DRC_LIMIT, VERIFY_TIMEOUT_SEC |

文件存在只是第一步。应校验工具/脚本/模型的版本与适用性、文件的 hash、库与约束的匹配关系、容器挂载中的实际可访问路径，以及允许的写入范围。不要用随机的同名文件替代缺项。

## 四、参数口径与预算

| 名称 | 含义与边界 |
| --- | --- |
| target_period_ns | 固定 Goal；0.1-5 ns，默认 0.5 |
| periodNs | 初始 probe 策略；0.1-5 ns，默认 0.35，精度 3 |
| floorplanUtilization | 双臂共用的初始利用率；0.2-0.8，默认 0.5，精度 3 |
| algorithmRevision | 选择程序的策略版本标记；0-99，默认 0；数值增加不自动修好代码 |
| legacy.CLOCK_NS | 后续双臂物理流程的共享时钟绑定；须与研究条件一起核对 |
| closingReserveMs | Pack 5 预留 60000 ms；进入收尾区不再允许新实验 |
| attemptLimit | Pack 5 总尝试上限 120；不是无限自动重试 |

为评估者分别填写“活动时间安排”和“系统 Run 预算”。例如 45 分钟访谈不等于给工具一个 45 分钟 Run；五分钟历史 study 也不是五分钟完整 EDA。不要把计划时长、实际耗时和计费混为一谈。模型 token/API 用量、EDA 时间/许可占用与开发助手的账号额度分别记录。

## 五、备份、恢复与结束交接

在未确认在途 Job 前，不用关闭窗口代替取消，也不重启共享 EDA 服务。备份前确定对应 Host 已停止写入；保存应用版本、Home、相关 workspace、Pack 方法与 run-assets、Site/Permit、必要会话和交接关系。对外迁移通过经确认的复制/分享流程处理，不默认包含客户资产。

恢复后先核对原 Run 状态、Job 真实状态、版本、材料 hash 和 owner。旧版本数据的迁移有专门接口与范围，不能将任意 Ledger 文件放到新 Home 就当作安全恢复。详细迁移操作应由维护人员按对应版本 README 执行。

本机原交付的启动器固定了特定 Home、凭据文件位置和 Catsights 显示器，因此**不可直接作为通用客户启动器分发**。为其他评估者准备独立入口，并先完成一次冷启动、普通小任务、退出和重启检查。
