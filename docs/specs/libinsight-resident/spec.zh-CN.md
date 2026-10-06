# LibInsight 驻场分析：QuaLib 提取与用户定制分析

依据：[ADR-0020](../../adr/0020-guide-conducts-libinsight-through-the-resident-agent.md)、
[ADR-0019](../../adr/0019-data-insight-frames-the-libinsight-app.md)、
[ADR-0017](../../adr/0017-resident-engineering-agent-owns-engineering-execution.md)、
[LibInsight 功能规格](../libinsight/spec.zh-CN.md)、[QuaLib 2026 资格](../../package-development/library-intelligence-platform/qualification/2026-09-24-qualib-2026.md)。
状态：2026-10-05 用户确认方向与四项选择；同日追加“驻场分析”标签页与实施授权（见文末修订），按修订切片实施。

## 用户场景

1. **提取一套库。** 用户在 Data Insight 旁对 Guide 说“分析 linglong 上 `<路径>` 这套 TSMC28 库”。Guide 给出
   有界方案卡（库路径与文件数、corner/view、Site、预算、产物），用户确认一次。驻场 Agent 在 linglong 用
   QuaLib API 逐文件提取 facts；Reader 核对后，facts 回到 Mac 的 LibInsight 数据文件夹，LibInsight 完成分析，
   Data Insight 中出现新 Kit。
2. **定制分析。** 用户说“找出 ff 相对 tt leakage 增长超过 3 倍的 cell，按 VT 分组”或“加入我们公司的
   max-transition 规则”。Guide 把需求整理成定制分析合同并获确认；驻场 Agent 在 linglong 编写代码、写
   fixture 测试、在当前 Kit 上运行并交付；Reader 校验后登记，LibInsight 中出现该分析的新页面。
3. **追问。** 用户在 LibInsight 页面上看到某个 cell/区域，点“Ask Guide about this view”，Guide 收到当前视图
   引用（Kit/variant/corner/页面/cell/arc），回答并指回证据；需要新计算时提出新的定制分析。

## 角色与现有模块

| 角色 | 责任 | 现有归属 |
| --- | --- | --- |
| Guide | 理解需求、提出方案卡、确认后启动 Run、汇报与追问 | `index.ts` 的 Guide 会话、`hima_prepare`/`hima_run`、`startGuidedRun` |
| 驻场工程 Agent | 提取与定制分析的工程：学习 playbook、编码、运行、交付 | ADR-0017：Pack `outsourcing`、resident wrapper、ACP、Podman |
| Pack 工具与 Reader | 确定性步骤与结果校验 | 新 Pack 的 `flow/`、`readers/`、`rules/` |
| LibInsight | 分析引擎、页面、定制分析呈现 | 外部仓库，按 ADR-0019 内嵌 |
| Host | Run/Job/DBOS、Site Channel、取回保留产物、viewer 进程 | `remote.ts`、`task-effects.ts`、`libinsight-viewer.ts` |

## Pack：`libinsight-analysis`（工作名）

图（每个节点独立可重试；`extract` 与 `custom-analysis` 是外包节点）：

```
prepare-kit → extract → admit-facts → deliver-kit → [custom-analysis → admit-analysis → deliver-analysis]
```

| 节点 | 执行者 | 输入 | 交付 | Reader 判据 |
| --- | --- | --- | --- | --- |
| `prepare-kit` | 工具 | 库目录（Site 路径）、Kit 声明 | 源清单：每个 `.lib` 的路径、SHA-256、大小、角色、corner 声明 | 清单与 Site 实际文件一致；路径在 Permit 读根内 |
| `extract` | 驻场 Agent | 源清单、QuaLib playbook | 每源一个 `lib-insight-facts/1` `.json.gz`、退出状态、前后源 hash、覆盖表 | 每个 facts 的 schema、`source.sha256_before == after == 清单`；失败源单列；不接受自述成功 |
| `admit-facts` | 工具 | facts 树 | 被接纳的 facts 清单与 partial 标记 | 全部源有状态；partial 明示 |
| `deliver-kit` | 工具（Host 取回） | 被接纳 facts | 写入 Mac 数据文件夹的 facts 与 Kit manifest，并经 viewer 启动 LibInsight 分阶段分析 | manifest 身份；分析结果以 LibInsight 的 `kit.json` result identity 为准 |
| `custom-analysis` | 驻场 Agent | 定制分析合同、facts/store、示例 | `analysis/<id>/<version>/`：代码、`manifest.json`、fixture 与测试结果、`result.json` | 见下 |
| `admit-analysis` / `deliver-analysis` | 工具 | 分析包 | 登记进数据文件夹的扩展点；同时生成 Retained report | 合同一致、fixture 通过、结果 schema 合法 |

定制分析合同（`hima-libinsight-analysis/1`）：`id`、`version`、`question`（用户原话与 Guide 整理的定义）、
`inputs`（只能是 facts/store/derived 的声明子集与 Kit/variant/corner 范围）、`output.kind`
（`table` | `heatmap` | `scatter` | `bar`，字段名、单位、null 原因）、`assumptions`、`limits`。
Reader 拒绝：读取声明外路径、缺 fixture 或 fixture 失败、输出字段/单位不符、缺失值写成 0、结果行无法
追溯到 facts 地址（cell/pin/arc/table address 与源 SHA）。

## Site：linglong 上的 LibInsight Site

新 Site 声明（例如 `sites/linglong-libinsight/`）复用 ATCS 的 resident wrapper 与 Podman 模式：

- 读根：库源目录（用户声明）、`/data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94`、
  `/data/eda/venvs/qualib-libapi-2026-py37`、resident 管理目录。
- 写根：`/data/eda/project/hima_harness/libinsight-runs`。
- 许可：QuaLib/Liberty API 许可声明与并发上限；`edarun` 作为 wrapper 入口；许可证模式只读，不切换。
- 驻场 Agent 运行时：沿用 `resident-engineering-wrapper.py`；LibInsight 代码（用于定制分析读取 facts/store）
  按 pin 的 commit 放在 Site 的只读位置，与 Mac 包内版本一致。

Site 侧准备（目录、wrapper 登记、LibInsight 代码副本）属于一次性管理员准备，执行前向用户确认。

## Playbook 与知识（Pack `knowledge/`）

| 文件 | 内容 |
| --- | --- |
| `qualib-api-playbook.md` | 运行时与许可（`edarun`、`LIBERTY_API_HOME`/`PYTHONPATH`/`LD_LIBRARY_PATH`、超时）；`tmlib` 读取、空句柄、一源一进程；不写源旁；退出码约定；来自资格脚本与原型提取器的已验证用法 |
| `facts-schema.md` | `lib-insight-facts/1` 字段、表地址、单位与缺失语义 |
| `kit-manifest.md` | Kit Release manifest：variants、corners、views、lens、physical |
| `custom-analysis-contract.md` | 上述合同、允许的输入、输出形状、fixture 要求、追溯要求 |
| `libinsight-engine.md` | 可复用的 LibInsight 模块（numerics、classify、metrics、envelope）与其调用方式 |
| `example-extraction.md`、`example-custom-analysis.md` | 一个完整的提取与一个完整的定制分析样例 |

## LibInsight 侧接口（由 LibInsight 会话实现，HimaHarness 只消费）

1. **当前视图通知。** 在 `app/static/app.js` 的 `save()`/`route()` 与 cell/issue 下钻处向父页面
   `postMessage({type:'libinsight/view', schema:1, kit, variant, corner, page, cell?, arc?, check?, issueId?}, '*')`；
   独立打开时不发送。只报告视图，不接收命令。
2. **定制分析扩展点。** 数据文件夹内 `analyses/<id>/<version>/{manifest.json,result.json}`（上述合同），
   LibInsight 启动时读取，在对应大类下增加一个页面，用通用渲染器呈现 `table/heatmap/scatter/bar`，并把每行
   下钻到 facts 地址；`manifest` 不合法时显示为错误条目而非静默忽略。

## HimaHarness 侧实施切片

| 切片 | 内容 | 最低测试 |
| --- | --- | --- |
| S1 视图引用 | `LibInsightAppPanel` 接收并校验 `libinsight/view`（origin、source、schema），“Ask Guide about this view” 写入草稿 | L3 fixture 页面发送消息；伪造来源被忽略 |
| S2 Pack 骨架 + 提取 | Pack、Site 声明、`prepare-kit`/`extract`/`admit-facts` Reader 与 playbook；Reader 反例 | L2 Pack contract + Reader 反例；L4 一个小库（SAED14 单文件）真实提取 |
| S3 交付到 Data Insight | `deliver-kit` 取回 facts、写 manifest、经 viewer 的 `/api/run/start` 分析；Data Insight 显示 Run 进度与新 Kit | L2 取回与 manifest；L3 viewer 出现新 Kit |
| S4 Guide 主导 | Guide 方案卡与一次确认启动，无 Campaign 页；中/英文对话 | L3 replay；L4 真实模型一次 |
| S5 定制分析 | `custom-analysis` 外包、合同 Reader、登记与过渡 Retained report | L2 Reader 反例；L4 一个真实定制分析 |
| S6 LibInsight 呈现 | 接上 LibInsight 扩展点（依赖其实现） | L3 新页面出现并可下钻 |

S1 与 S2 可并行；S3 依赖 S2；S5 依赖 S2/S3；S6 依赖 LibInsight 扩展点。每个切片 commit 后推送并核对远端 SHA。

## 验收示例

- 通过：SAED14 单文件 → 方案卡 → 确认 → 驻场 Agent 提取 → Reader 接纳（hash 前后一致）→ Data Insight
  出现该 Kit 的 Health 页。
- 反例：Agent 交付的 facts 源 hash 与清单不同 → Reader 拒绝，该源标 failed，Kit 标 partial，不显示为 clean。
- 通过：定制分析“ff/tt leakage 比值 > 3”交付表格，每行可下钻到两个 corner 的 leakage 地址。
- 反例：定制分析把缺失 leakage 写成 0，或读取声明外目录 → Reader 拒绝，Guide 说明原因。

## 不在本轮

- 修改厂商 QuaLib 运行时、许可证服务或系统 Python。
- 在 Mac 本地运行 QuaLib API。
- 跨 release/PDK/供应商比较（沿用 LibInsight 规格）。
- 定制分析结果写回 Liberty 或生成工具约束文件。

## 回滚

Pack 与 Site 为新增文件，可整体移除；Data Insight 的 viewer 不依赖本 Pack。各切片独立提交。

## 2026-10-05 修订：Data Insight 的“驻场分析”标签页

用户追加：在 Data Insight 中为驻场 OpenCode 开一个标签页做定制图表；驻场 OpenCode 带 QuaLib API playbook，
可以在 linglong 上基于它做 QuaLib API 编程与开发。同日确认：可在 linglong 做一次性准备并运行真实 QuaLib 与
模型任务；LibInsight 仓库保持不动（视图通知与 LibInsight 内页面等其自身会话实现）。

### 用户路径

1. Data Insight 顶栏新增 **Resident analyses**（与 LibInsight pages、Retained reports 并列）。用户输入问题，
   可选列出 linglong 上的 `.lib` 路径与要沿用的已登记分析。
2. Host 把请求写入 Site 上的请求文件，按 Pack `libinsight-analysis` 与 Site `linglong-libinsight` 做一次准备，
   标签页显示有界方案卡（问题、源、Site、Pack 版本、预算）；用户点 Confirm 即一次确认，由当前会话作为 Guide
   经 `startGuidedRun` 启动普通 durable Run。不经过 Campaign 配置页。
3. 驻场 OpenCode 按 playbook 在私有工作区写代码、在 linglong 运行（可直接调用 QuaLib API），交付分析包；Pack
   Reader 校验后，`admit-analysis` 把代码与结果登记进 Site 的分析库，后续请求可在其上继续开发。
4. 标签页列出每次请求的状态与结果，用通用渲染器画出 `table/bar/line/scatter/heatmap`，并显示摘要、假设、
   限制、源 hash 与主脚本代码。结果来自 Host 保留的 Reader 输入字节，不另读 Site。

每次请求是一个任务局部 Run（ADR-0017 Q5），不是常驻会话；连续开发依靠 Site 分析库与 `buildsOn`。

### 合同

- 请求 `hima-libinsight-request/1`（Host 写入）：`requestId`、`question`（≤4000 字）、`sources[]`（Site 绝对路径，
  可空）、`buildsOn[]`（已登记分析 `id@version`，可空）、`createdAt`。
- `prepare-request` 输出 `hima-libinsight-prepared-request/1`：请求原文、每个源的 `sha256/bytes`、分析库目录
  （已登记分析的 id、version、问题、路径）。
- 交付 `hima-libinsight-analysis/1`：`id`（slug）、`version`（正整数）、`question`、`summary`、`sources[]`
  （`path`、`sha256Before`、`sha256After`）、`datasets{name:{columns[{name,type,unit?}],rows[][]}}`、
  `plots[]`（`id,title,kind,dataset,x,y,series?,value?`）、`code{main{path,sha256,text},files[]}`、
  `run{command,exitCode,elapsedSeconds,usedQualib}`、`assumptions[]`、`limits[]`。
  Reader 拒绝：schema 不符、非有限数、缺失值写成 0 的声明冲突（列声明 `nullMeans` 才允许 null）、源 hash 前后
  不一致或与准备清单不符、代码 hash 与交付树不符、超出大小上限（每数据集 ≤ 20000 行、结果 ≤ 4 MiB）。
- 登记 `hima-libinsight-admission/1`：`id`、`version`、库内路径、结果与代码 hash。

### Site `linglong-libinsight`

工作根 `/data/eda/project/hima_harness/libinsight-runs`（`campaigns/`、`requests/`、`library/`）；读根加入
QuaLib API、`qualib-libapi-2026-py37`、`/data/eda/pdk/saed14`、`/data/eda/project/techlib/tsmc28`；驻场
capability 复用已安装的 `resident-engineering-v1` wrapper 与 edarunner 镜像，新增本 Site 的 capability 文件；
实时 QuaLib 需要 linglong 的 Empyrean 许可证模式为 `new`（用户以 `empyrean-license new|old` 切换，XTop 需 `old`）；
QuaLib 命令经 EDA 初始化脚本取得当前模式的许可证，进程逐个运行。facts 模式不需要许可证。已知限制：跨 Site 的
XTop 与 QuaLib 并发不由 Host 互斥，模式切换由操作员串行（同 library-intelligence 的说明）。

### 切片（替代上表的执行顺序）

| 切片 | 内容 | 最低测试 |
| --- | --- | --- |
| R1 Pack + Site + playbook | `packs/libinsight-analysis`、`sites/linglong-libinsight`、QuaLib playbook 与知识、Reader/工具及反例 | Pack Python 单测（Reader 反例）；L2 durable Host 用 ACP 替身走完整图 |
| R2 Host 操作 | `index.ts`/`remote.ts`：propose、confirm、list；保留结果投影 | L2 HTTP：坏会话 403、方案与启动、列表含已登记结果 |
| R3 标签页 | `LibInsightResidentPanel`、图表渲染、Data Insight 第三个视图 | L1 渲染投影；L3 桌面：方案卡、确认、结果图 |
| R4 真实验证 | linglong 一次性准备；SAED14 单文件真实定制图（真实模型 + QuaLib） | L4，打包 App 在 Catsights 操作 |

原 S2/S3（提取并交付 Kit 到 LibInsight 数据文件夹）与 S1/S6（依赖 LibInsight 接口）不在本轮；S4 的 Guide
对话入口在标签页之后评估。

## 2026-10-05 再修订：对话入口与独立结果网页

用户明确：Data Insight 的 LibInsight 页面是默认分析；定制分析从 Guide 对话发起，结果在独立网页呈现；
不使用 Data Insight 内的表单。决定见 [ADR-0021](../../adr/0021-guide-chat-starts-library-analyses-shown-on-their-own-page.md)。
上文“驻场分析”标签页的用户路径 1、2、4 由下列路径替代，合同、Site 与 Reader 不变。

1. 用户在对话中提问（可附 linglong 上的 `.lib` 路径或要沿用的已登记分析）。Guide 调用
   `hima_insight_analysis` `propose`，对话中出现方案卡；Guide 用自然语言复述并询问是否开始。
2. 用户在对话中同意后，Guide 调用 `confirm` 启动 Run，启动卡给出“Open analysis page”。
3. Run 结束或受阻时，Guide 收到 Host 的边界通知，调用 `result` 并在对话中汇报结论与网页地址。
4. 网页 `/hima/analysis/<runId>?session=<id>` 由 Host 服务端渲染，桌面 App 以新窗口打开；运行中自刷新，
   完成后显示摘要、图表、数据表、假设、限制、源 hash、命令与代码。

| 切片 | 内容 | 最低测试 |
| --- | --- | --- |
| G1 结果网页 | `analysis-page.ts` 渲染；`/hima/analysis/` 路由（栅栏、会话、项目授权） | 单测渲染与转义；L2 HTTP：坏会话 403、他项目 Run 拒绝、页面字节来自 Reader 接纳的结果 |
| G2 Guide 工具与卡片 | `hima_insight_analysis` 四个动作；对话卡片；产品上下文说明 | L2 durable Host：工具 propose→confirm→result 走完整图；客户端卡片投影单测 |
| G3 移除标签页 | 删除 Resident analyses 标签页及 `propose/confirm` 路由 | 客户端类型检查；L3 Data Insight 回归 |
| G4 真实验证 | 打包 App，Catsights，中/英文对话各一次真实分析 | L4 |
