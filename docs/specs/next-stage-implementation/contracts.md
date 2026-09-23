# 共享接口约定与单一写入归属

基线：`1a79cb1`。以下是本批规格的接口决策，不是已经存在的 API，也不是四个新模块。提供方在现有类型、Host route、DSH seam 或 Pack report 上落实；消费者不得各自维护同一事实。具体注册名称沿现有命名，文件拆分仅在原职责内进行。

## K1 — 角色、上下文和人的表达

S04 提供稳定角色说明、公共术语/别名和动态上下文投影；S08、S10、S06、S09消费。稳定说明不含当前Run值，动态事实不由模型文案回写。

- Request：真实session/workspace绑定、明确目标address、requestId；选择状态是定位线索，不是执行授权。
- 唯一目标合同 `TargetAddress` 分四类：run（runId）、node（runId/nodeId及所问executionId或generation）、report（reportRef/version/sha256）、child（parentSessionId/childSessionId）。缺失、陈旧与非法字段由同一Host resolver处理。
- S04的Guide选择直接使用TargetAddress；S08的campaign/insight标签是本地展示mode。campaign+runId映射run，insight的已选报告映射完整report身份，child详情映射child。无目标的标签只显示准备态，不是空TargetAddress，也不发运行请求。
- 当UI仅持有reportRef时，先通过同一只读resolver取得版本/hash再显示；不得另造Guide/Workbench两套报告身份或解析规则。workspace由真实Host/session解析，显示名无授权效力。
- Response：resolved scope/address、ownedRun（若有）、asOf/sourceRevision、事实及出处、missing/unknown、适用条件。不存在/无权/陈旧/不可读分别给原因，不用一个空对象混过。
- 只读context接口只返回投影；控制通过K3独立调用。Guide能安排执行会话，不能自行把selected对象绑定为owner。
- UI仅接受仍对应当前address/request的响应，防止迟到结果串对象。普通进度更新面板，用户需要处理或最终结果才通知。
- 默认语言是业务结果、必要EDA指标、原因与下一步；研究问题提供完整依据，内部ID/轨迹按需展开。英文API名不强行改成中文标识符。

## K2 — 记忆引用与恢复

S05提供有来源的摘要/经验，S01提供当前运行事实，S04/S06/S10消费。M1先核实原生载体：Session记录与查询/compaction、工作区文件、Knowledge/Archive公开能力；不直接写DSH内部事件或再建数据库。

- 工作摘要至少标schema、scope（workspace/session/run/child及适用身份）、目标/决定/待办、source refs、生成时刻/版本、模型摘要标记与current/stale/conflicted/unavailable状态。
- 引用的测量以原报告、Ledger和hash为准；摘要不能清除暂停、重置预算、继承owner权限或确认Job执行。
- 恢复顺序：读当前控制/Job/输入 → 验证引用与适用条件 → 形成摘要 → 原owner决策。S01负责真正恢复，S05不调用launch。
- 经验采用记录含candidateRef、适用条件、采用/停用/被更正状态、用户更正、新依据和来源。原证据保持；停用在compact/reopen后仍生效。
- 相同Site不等于同项目；多工作区显式关联、跨项目显式引用、已确认个人偏好可共享。摘要缺失降级成诚实的材料缺项，不阻塞纯只读UI。

## K3 — 控制、委派和交互回执

S01拥有Run控制与恢复语义；S06拥有原生child合同；S09拥有Job内交互命令；它们在同一Host/Fabric事实系统内衔接。

- 人类控制请求含目标、requestId、expectedEpoch/revision和可信用户指令关联。模型生成文本或任意origin字段不是人类授权。Host校验后才走原控制动作。
- 执行回执沿现有accepted/refused/duplicate/uncertain结果，分别呈现请求已收、事实已提交、效果已确认；未知停止不能称已停止。
- 委派含parent/child身份、关联任务/Run/node、输入版本、role、effective模型/工具/写范围、预算份额、依赖、recipient与产物。共享预算在父任务总额内扣费，Job资源/许可证继续由现有Site机制承担。
- DSH child创建若不具幂等API：派发前保留意图，重启后查原生lineage/实际会话；查不清则uncertain，不重复spawn。合同落盘载体使用现有Session/Run记录，不能以新daemon解决未知。
- 一条交互命令含toolSessionId、commandId、inputDigest和requestId；write前留意图、之后确认派发，同ID异内容拒绝。原生idle不释放Hima单写者门。
- 调用等待、命令期限、会话期限、任务总预算不同；wait不是kill。授权范围可以自由组织命令，但环境必须实际拦住越界，不能依赖prompt承诺。
- 普通Coding和Researcher可以先交付；Operator mutation只有S01/S06/S09相应资格通过后开放。只读视图合同与实际写权限分别验收。

## K4 — 报告、代际变化与 Insight

S07提供业务变化，S11提供Library语义，S03提供采用资格；S08只消费typed view。复用原Reader/observation/analysis/Archive引用，图表缓存不成为结果数据库。

- 报告身份含schema、产物ref/hash、方法/输入版本、生成时间、run/generation或独立任务身份、单位与测量条件、coverage、unknown、来源。
- Library事实区分库内数值与设计实测；Cell/arc/drive/VT/PVT/load/slew的比较条件必须明确。API失败不得生成半份有效facts。
- 代际变化保留原frontier/demand分母，fixed/remaining/entrant/regressed和missing分别表达；条件变化先标不可比，不伪造delta。
- 已加载数据筛选仅改变view state，不调模型或运行工具；新计算说明范围并在原预算内运行，保存新版本与旧结果的关联。
- 独立分析计算仍关联原受控Run，前台保持Data Insight；打开旧报告不建空Run。报告动作proposal不等于已执行或已授权扩展。
- best资格、研究解释、局部代理和全局测量分开。全局结论仍经过既有Judge及同代证据。

## 所有权与集成顺序

| 文件组 | 唯一修改责任 | 其他规格如何协作 |
| --- | --- | --- |
| `index.ts`, `remote.ts`, `tools.ts`, `ledger.ts`, `fabric.ts` | 主集成者按子切片顺序接线 | 各线提交消费合同、独立局部实现/fixture；不在并行分支重定义同一身份/schema |
| `sites.ts`、`channel.ts` 的发现政策 | S02 | S09待该修改合入后补交互传输，不能同时整文件重构 |
| `jobs.ts`、`channel.ts` 交互部分 | S09，S01提供控制合同 | 批量Job兼容测试原样保留 |
| Desktop `main.ts/host-launch.ts` | S01生命周期 | S12只做打包/发布receipt，不改运行生命周期 |
| client `HimaWorkbench.tsx/index.ts/api.ts/workbench-style.ts` | S08 UI负责人 | S04/S05/S06/S09/S11交付typed payload/局部视图需求，由S08整合，不各造导航 |
| `workshop.ts` 知识/摘要读取、`experience.ts` | S05 | S06/S10消费其接口；如需同文件调整，S05合入后再排一次接线 |
| `authoring.ts`, `packs.ts`, `release.ts` 作者/发布 | S10 | S09工具声明/guard增量顺序接入；S12调用发布接口不重复实现 |
| XTop `flow/closure.py`、Reader/规则 | S03先改有效性，S07后改反馈，S09最后接adapter | 可并行写各自fixture/模板；共享文件串行，保留唯一Pack版本负责人 |
| DTCO research/Reader合同 | S07 | S11只读取其稳定引用，不能重写mock/generator；S12负责固定版本打包 |

原型、视觉稿、adapter helper、schema局部类型不是新服务。若某实现需要跨多个模块新增持久生命周期/身份权威，停止该扩张切片，先按ADR-0001给必要性、替代方案与成本证据；不能以“spec允许新文件”当作新架构授权。
