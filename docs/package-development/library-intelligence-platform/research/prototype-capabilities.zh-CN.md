# LibInsight 原型功能与集成基线核查

日期：2026-09-29。用户指定 `/Users/lluzi/code/lib_insight` 为 Library 分析特性的 Prototype。
本次只读核查源码，原目录未修改。源分支 `feat/review-revision`，提交
`8e3abdc47adcd4d2662c161e6b85f0a9d706df47`，前后工作区均干净。

**这是一套已有算法、数据流程和交互的 Liberty 分析原型。后续 LibInsight 集成以它的实际能力为起点，
接入 HimaHarness 现有执行和证据机制，并增补 LEF/pin-access 评估。** Hima 现有有界 Library 报告
不能代表这个原型的全部功能；前期产品研究也不替代对该源码的核查。

## 实际实现与数据流程

原型由 Python/NumPy 分析后端、Python 本地 HTTP 服务和原生 JavaScript/SVG 前端组成。
分析对象是 Kit Release，包含多个 Variant、Corner、View；可选 Usage Lens 导入网表和时序报告。
术语来自原型 [CONTEXT.md](/Users/lluzi/code/lib_insight/CONTEXT.md)，用于理解来源，不自动覆盖
polishing 的产品定义或领域约定。

数据链为：原生 Liberty API 提取 → 压缩 facts → 统一单位的 store → Kit 分析/候选问题 →
按设置判定及派生指标 → 本地服务 → 页面/图表/证据下钻。

| 功能 | 已核查的实际内容 | 主要源码 |
| --- | --- | --- |
| 数据提取与存储 | source hash、提取器身份、结构化 pin/arc/table；可选 copy/re-read；表值打包到 NumPy 数组、cell 按需读取 | [extract/libapi_extract.py](/Users/lluzi/code/lib_insight/extract/libapi_extract.py:281)、[store.py](/Users/lluzi/code/lib_insight/libinsight/store.py:82) |
| 库健康检查 | 25 项命名检查，分 Integrity、Accuracy、Plausibility、Optimization；分别表达错误、警告、机会 | [specs.py](/Users/lluzi/code/lib_insight/libinsight/expectations/specs.py:31) |
| 问题定位 | Issue type / Place、Attention queue、Pattern/Outlier、每项问题的依据、幅度、容差和来源；可下钻到 table/Fact | [attention.py](/Users/lluzi/code/lib_insight/libinsight/attention.py)、[evidence.py](/Users/lluzi/code/lib_insight/libinsight/evidence.py)、[App.entry](/Users/lluzi/code/lib_insight/app/server.py:714) |
| 表格精度 | index/shape、缺失、pin limit 覆盖、插值误差估计、外推、单调性、spike/kink 与 LVF 检查 | [numerics.py](/Users/lluzi/code/lib_insight/libinsight/numerics.py)、[expectations/tables.py](/Users/lluzi/code/lib_insight/libinsight/expectations/tables.py) |
| 电气能力比较 | FO1/FO4/FO8、自定义 slew/load、设计 operating point；delay/transition/驱动/能量/泄漏/顺序单元指标与 Pareto dominance | [metrics.py](/Users/lluzi/code/lib_insight/libinsight/metrics.py)、[reference.py](/Users/lluzi/code/lib_insight/libinsight/reference.py) |
| 分类与优化结构 | 基于函数/语义的 cell class、family、drive ladder、swap set、VT twin；名称辅助与不确定性 | [classify.py](/Users/lluzi/code/lib_insight/libinsight/classify.py)、[naming.py](/Users/lluzi/code/lib_insight/libinsight/naming.py) |
| Corner 与 voltage sensitivity | setup/hold 限制 corner、温度趋势；相同 process/temperature 的电压序列，每个 cell 相对其参考 inverter 的减速、watch list 与跨 VT 比较 | [voltage.py](/Users/lluzi/code/lib_insight/libinsight/voltage.py)、[App.voltage](/Users/lluzi/code/lib_insight/app/server.py:1021) |
| Variation 与 Variant 比较 | delay σ/μ、缺少 sigma 数据；同条件下匹配 cell 的能力和取舍 | [App.i8](/Users/lluzi/code/lib_insight/app/server.py:1307)、[App.pareto](/Users/lluzi/code/lib_insight/app/server.py:1219) |
| 设计使用分析 | 从网表统计 leaf master 使用；从特定时序报告格式读取路径和 slew/load；重排问题关注度，查看 operating points | [lens.py](/Users/lluzi/code/lib_insight/libinsight/lens.py:29) |
| 设置与公司规则 | 预设/自定义检查参数、基于候选重新判定；固定指标集的绝对值或 class median 规则，预览、激活、删除 | [settings.py](/Users/lluzi/code/lib_insight/libinsight/settings.py)、[policy.py](/Users/lluzi/code/lib_insight/libinsight/policy.py:28) |
| 行动与校准 | 生成 dont_use Tcl/CSV 和重新表征请求；E8 留点验证、人工作标注审计、历史与一致性统计 | [actions.py](/Users/lluzi/code/lib_insight/libinsight/actions.py:25)、[calibrate.py](/Users/lluzi/code/lib_insight/libinsight/calibrate.py:110) |

前端 `PAGES` 实际注册了 **13 个页面**：Health、Issues、Table accuracy、Checks and rules、Best cells、
Corners、Voltage sensitivity、Drive ladders、Variation、Compare variants、Design impact、Operating points、Actions。
它还具有独立问题详情页、图表/表格下钻、全局参考条件和 delay 定义切换、过滤及分页。
这些是代码接线核查，尚未逐页进行真实浏览器操作验证。[前端页面注册](/Users/lluzi/code/lib_insight/app/static/app.js:1374)

## 25 项检查的内容

| 范围 | 检查 |
| --- | --- |
| E1–E6 | Corner 结构、header 单位/阈值、timing sense 与 function、conditional arcs、table index/shape、缺失数据 |
| E7–E12 | pin limit 覆盖、插值精度估计、数值符号、LVF 覆盖与一致性、不同电气 View 中对应表的一致性 |
| E13–E18 | load 趋势、spike/kink、电压趋势、VT 趋势、drive scaling、setup+hold window |
| E19–E25 | drive 排序、drive 间隔、swap set、VT twin、CTS cell、hold-fix cell、优化可用限制 |

这些检查名表达原型的检查意图，不能把所有名称都解释为普遍成立的物理定律。例如 E7/E8 被代码标为
Estimate；精度、趋势例外和适用范围需随结果保留。更细的函数/测试对应关系见[分析证据包](prototype-analysis-evidence.md)。

## 原型边界与集成时必须保留的信息

1. **没有现成的 LEF/pin-access 分析。** 已核查的 `libinsight/`、`app/`、`extract/` 和测试提供 Liberty
   模型与检查，没有 LEF reader、PORT/OBS 几何、技术规则、联合 routing 或 pin-access 概率实现。
   后续是在保留这些 Library 分析能力的同时新增物理侧。
2. **CCS/vector waveform 没有完整提取。** `value_table` 遇到 `isCcsModel/isVectorModel` 会计数并跳过。
   原型中的跨 View 检查不能据此称为完整 waveform/model equivalence 验证。
   [实际分支](/Users/lluzi/code/lib_insight/extract/libapi_extract.py:85)
3. **缺失值处理需要适配。** 当前 `convert_facts` 会把缺少/不能转成数字的 pin capacitance、cell area、
   leakage value 写成 0。接入 Hima 的事实模型前应回到原始字段和覆盖状态区分“缺失”与“实测/声明为零”，
   不能只迁移派生数组。[转换代码](/Users/lluzi/code/lib_insight/libinsight/store.py:95)
4. **检查失败有状态，不能丢失。** runner 捕获单项异常后继续其他检查，并记录 `error:`；不能只取其
   findings 数量来声称库 clean。[runner](/Users/lluzi/code/lib_insight/libinsight/expectations/__init__.py:19)
5. **设计输入支持范围有限。** 网表和时序报告是具体的正则解析方式；只覆盖导入报告中的路径，不能据此
   声称完整 STA coverage。公司规则是结构化规则构建器，不是任意 Python 算法沙箱。
6. **参考条件与证据性质不可压平。** FO4、absolute、Usage Lens 的 slew/load、外推标记、Estimate、
   preset、被跳过的样本和未审计状态是结果的一部分。E8 显示文字明确说明 decision factor 在同一批
   held-out 点上选择，因此后续 precision 属于该选择过程的 in-sample 结果。
   [可靠性显示](/Users/lluzi/code/lib_insight/app/static/app.js:126)
7. **行动生成不等于执行。** dont_use 和重新表征输出是建议文件；没有完成工具应用、库修改或真实 PPA
   验证。原型自带的 Sign-off preset 名称也不表示 foundry/signoff 已通过。

## 与 HimaHarness 的关系

| 应保留的原型价值 | Hima 中需要适配的部分 |
| --- | --- |
| 库/Variant/Corner/View 身份，cell/arc/Fact 寻址 | 原始文件、Job、Record 与报告版本的可追溯关联；新增物理 master 映射 |
| 数值、检查、分类、voltage 与问题聚合算法 | 先在原职责内复用，输入/输出接入现有 Pack/Reader；保留失败与 unknown |
| 13 页中的分析能力与图表解释细节 | 按现有三类分析任务在 Data Insight 中组织；页面数量与导航结构不直接照搬 |
| Reference Condition 和检查设置的交互 | 区分读取已有结果与新计算，后者关联受控任务和新结果版本 |
| 审计、公司规则、行动建议 | 保存方法/规则身份及权限；建议、执行和验证分开 |

当前 Hima 的 [LibraryInsightPanel](../../../../packages/harness/src/client/LibraryInsightPanel.tsx) 主要显示
retained report、条件/严重度过滤和证据引用，明确没有交互重算能力。因此不能用它已有的薄报告能力
代替原型的完整功能清单。原型的本地 HTTP server 和可变 `data/` 文件并非必须原样嵌入的产品架构。

源提取脚本含固定 linglong 运行目录、Python/API 路径和 `edarun` 调用；集成时需转为现有 Site/Permit/
Job 输入及资格流程。本轮没有运行这些脚本、读取真实库数据或操作远端环境。

## 本轮验证与交付状态

- 从指定提交 `git archive` 出 `app/libinsight/tests/extract` 到 polishing 的忽略临时目录；测试只使用原型
  自带合成 fixtures。原仓库未运行测试、未写缓存，前后 HEAD 与 tracked status 不变。
- Python 3.9.6、NumPy 2.0.2、pytest 8.4.2：**274 passed，0 failed，0 errors，0 skipped，54.76 s**。
- `app.js` 与 `charts.js` 的 `node --check` 通过；这不是浏览器渲染/交互验收。
- 未验证：真实 Liberty API 提取、真实库完整性与规则精度、真实 STA dialect、完整 UI 操作、Hima 集成、
  LEF/pin access。测试通过只适用于该源码快照和上述合成场景。
- 主会话负责数据/界面/集成核查和运行；Terra/medium 子任务独立检查算法与测试断言，没有进一步派工。

可复核产物：[运行身份及源码 hash](prototype-audit/receipt.json)、[JUnit 原始结果](prototype-audit/synthetic-tests.xml)、
[算法证据包](prototype-analysis-evidence.md)。本次新增文档与测试证据，尚未迁移原型代码。
