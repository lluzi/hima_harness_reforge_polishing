# Fabric 开源基础研究：独立读者与证据语义复核

复核者：独立 fresh-context Codex reader，派工配置 GPT-6.1-sol / high；未派子 agent。完成时间：2026-10-02 22:06 PDT（2026-10-03 05:06 UTC）。产品基线 `77223febe236df94d4db4eb006b6c9e612c62206`；只复核 `future` 的研究材料，不修改产品或主稿。

**结论：当前稿通过本轮有界的读者价值与关键证据语义复核，可以作为条件性选型研究交付。没有发现尚未处理、足以推翻候选排序的事实错误。它没有证明任何候选在 Hima 中长期更可靠或净维护成本更低，也没有宣称已证明。** 第4节“持久保存”的边界最初有误读空间，主协调者已在复核期间补清。剩余建议是文字精简，不需要增加候选、治理流程、架构或测试范围。

## 1. 不读来源库时能复述什么

先完整阅读主稿，再看来源库；读者测试没有依赖台账替正文补叙述。

| 核心判断 | 正文已给出的具体现场或机制 | 最可信的反对理由 | 选择前提与继续/否决信号 |
|---|---|---|---|
| Hima 应先明确成果消费、节点完成和 Goal；引擎只能承担其中的执行机械工作 | 当前 Judge/Explore 依赖第一规则、前两规则、最近 observation；endRun 依赖 Explore Decision。正文明确这是当前源码静态观察，不是本轮实跑故障 | 完整图引擎可能删除更多旧耦合，保留自研也会永久承担并发与恢复正确性 | 借机制路线适合控制扰动；若不停补通用重放/调度设施而无法收敛，应停止扩展。采用框架必须能删除旧职责，并保留 Reader/Goal 与成果身份 |
| DBOS 和 LangGraph 是两种第一对照：前者看持久执行，后者看图表达 | Reader 步骤结果确认保存后崩溃，DBOS 可读回步骤结果；LangGraph 的节点/边与 Command 接近业务结果推进，但 shared state 仍可能重造“最新值”隐含依赖 | Temporal 的长期维护总账可能更低；Restate 的单 binary 降低服务形态负担；DBOS 接入后若仍需双日志对账，优先级应下降 | DBOS 须接受 PostgreSQL；LangGraph 须解决 checkpointer、旧图兼容及唯一执行权威。通过故障/升级语义并确实删职责才继续，靠第二套控制状态补洞则停止 |
| 持久日志不能自动确保外部 EDA effect 只发生一次，unknown 应保留 | EDA 启动后、checkpoint 前崩溃；DBOS zombie；Restate 数据库写成功但 completion 未见的重复窗口；取消与远端完成竞争 | 若目标接受稳定幂等键或可靠 Job 查询，适配协议可以关闭大量窗口，不能因通用框架有边界就否定采用 | 固定 effect/Job 身份并核对原作业；重复启动、清掉 hold、丢来源或技术成功冒充 Goal 均否决接线 |

案例主要是 Hima 的具体静态路径、官方机制反例与假设故障现场，不是长期用户部署成功案例。正文已标明没有运行故障实验，故不构成虚假一手经验。读者仍缺部署偏好、实际适配/删除职责数量、故障比较和维护成本；这些缺口在正文中可见，无需打开来源库才知道。

## 2. 排序与成熟度判断

- **DBOS 第一对照有条件成立。** 报告用 TS Host 接入形态与持久步骤机制说明其位置，明确 PostgreSQL、确定性序列、旧执行器、多 executor 接管与 Conductor 许可成本；不是“只需加依赖就可靠”。建议是比较优先级，不是已选型或普遍最佳。
- **LangGraph 业务图第一对照有条件成立。** 图表达与业务结果推进的吻合支持这个研究位置；正文没有把普通函数节点说成天然具备 Hima 的 Reader/Goal/成果来源语义，并保留升级和 shared state 反证。
- **Temporal / Restate 不被部署形态先验排除。** 正文承认长期 Run、多 worker 可能让服务成本值得承担；Restate 的 BSL 与 SDK MIT 区分正确。没有把服务多一个进程直接等同成本更高，也没有把当前 release 直接等同成熟可靠。
- **没有虚构净收益。** “可能”“若能删除”“未验证净收益”与各路线的反对理由一致；第7节测量建议是未来提案。Effect unstable 的降级理由有固定源码支持。

文中“成熟执行引擎”是较宽的概括。若追求最严措辞，可改成“已有持久执行引擎”，避免读者把成熟度理解成经过本轮对比验证；这不是阻断项。

## 3. 独立打开的关键官方来源与语义结果

本轮没有泛搜；只打开主稿/证据包指向的官方页面、registry 元数据与固定 SHA 源码。HTTP 可达及元数据读取与人工语义检查都实际进行，未运行框架。

| 关键事实 | 本轮独立检查 | 结果与限制 |
|---|---|---|
| DBOS v5.2、npm 5.2.11 与 Node | [npm latest](https://registry.npmjs.org/@dbos-inc/dbos-sdk/latest)、[固定 package.json](https://raw.githubusercontent.com/dbos-inc/dbos-transact-ts/3f36908f58fd8b3079cbf5372203c7a2d0ba06cc/package.json)、[release 元数据](https://api.github.com/repos/dbos-inc/dbos-transact-ts/releases/tags/v5.2) | npm 5.2.11 的 gitHead 是 `3f36908…`，engines 为 Node >=20；固定源码 version 是构建占位符，不能拿它当发布包号；release 确有 Conflict Resolution / Consistent Resume 变更。主稿已补准确包号与 Node 条件 |
| DBOS 重启恢复与 external effect 边界 | [固定 executor](https://raw.githubusercontent.com/dbos-inc/dbos-transact-ts/3f36908f58fd8b3079cbf5372203c7a2d0ba06cc/src/dbos-executor.ts)、[Concurrent Executions](https://docs.dbos.dev/explanations/concurrent-executions) | 固定源码第389行启动恢复本 executor 的 pending workflows；官方说明 ownership 在 checkpoint 事务中核验，step 是 at-least-once，zombie 到下一 checkpoint 才停止。支持“不撤销已发远端动作”，不证明跨 executor 自动接管已接好 |
| LangGraph 最新图恢复与 drain | [Backward compatibility](https://docs.langchain.com/oss/javascript/langgraph/backward-compatibility)、[Fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance)、[固定 run_control 测试定义](https://raw.githubusercontent.com/langchain-ai/langgraphjs/ec8cb378e3c7846b2a4aea31dfc4aff8f1cbf2fb/libs/langgraph-core/src/tests/run_control.test.ts)、[固定 core package](https://raw.githubusercontent.com/langchain-ai/langgraphjs/ec8cb378e3c7846b2a4aea31dfc4aff8f1cbf2fb/libs/langgraph-core/package.json) | 官方明确最新 deployed graph 用于旧 thread；drain 在 superstep 间生效，在途 node/retry 继续，可能同 tick 正常结束。固定 SHA 含 RunControl 测试定义，core package 为 1.4.18 / Node >=18。只是读测试定义，未执行。两项 URL 已由主协调者修正，不再作为缺陷 |
| Effect API 稳定性及嵌入前提 | [固定 Workflow](https://raw.githubusercontent.com/Effect-TS/effect/67ba4e46a11ccda0b6761578bfd22c04ae00167d/packages/effect/src/workflow/Workflow.ts)、[固定 SingleRunner](https://raw.githubusercontent.com/Effect-TS/effect/67ba4e46a11ccda0b6761578bfd22c04ae00167d/packages/effect/src/cluster/SingleRunner.ts) | Workflow 模块头与API标 unstable；SingleRunner 明确用于 local/embedded/small single-node，messages/replies 始终在 SQL，runnerStorage=memory 不取消 SQL 条件。支持设计参考定位，未证明 Hima 适配有效 |
| 外部数据库写入与执行日志之间有重复窗口 | [Restate databases](https://docs.restate.dev/guides/databases) | 官方例子直接说明 query 成功但 Restate 未见 completion 可重复更新，并给出版本条件写/同事务幂等 token 等额外协议。支持真实 effect 与 journal 不自动原子的结论，不应扩成“永远无法关闭窗口” |

补充核对：[Temporal Worker Versioning](https://docs.temporal.io/production-deployment/worker-deployments/worker-versioning) 明确 pinned workflow 留在开始的 Worker Deployment Version；[Restate 固定 LICENSE](https://github.com/restatedev/restate/blob/5ab87a6b5eabb70d5ba09738e281edc69b6ae10e/LICENSE) 明确 BSL 当前不是 Open Source license，附加授权及限制并存。正文没有拿 SDK 许可代替服务端许可，也未替未来商业形态下法律结论。

## 4. 真正误导风险与最小修改

**已关闭的语义风险：第4节B的“成果已持久保存”。** 初稿只说持久存储已确认，读者可能把“文件/Ledger 已落盘”误读成候选必然可接续。主协调者现已说明必须是候选内核确认保存的步骤返回值或节点写入；只在 Hima Ledger 或文件中有记录不够。这个修改足以关闭风险，不需要扩展设计。

**剩余低优先建议：区分故障窗口与路线的同名 A/B/C。** 第6节路线B的“继续：A/B/C与旧Run升级都满足语义”易被误读成三条路线均须通过。最小修改为“继续：三类故障窗口与旧 Run 升级均满足语义”。第7节也可沿用“三类故障窗口”，无需重命名全稿。

没有发现新的应阻断交付的事实错误。未建议增加更多框架、真实 EDA、SLA 调研或新治理门槛；它们超出当前“调查开源基础”的授权。

## 5. 长度、方法重复与抽象程度

正文约八个短节、候选表、三个故障窗口和路线表，长度与当前多候选研究相称。核心结论在开头可见，方法/台账主要留在支持材料中，没有要求读者先学证据编码。三种故障现场使“可靠性”和“双日志”不只是抽象口号。

第6节的继续/停止信号与第7节的验证指标有少量重复，但分别承担选项取舍和未来样例提案，尚未明显挤占信息。若要再缩短，可删第7节的迁移/导出细节并保留“旧 Run 维持原实现、不作运行中强迁移”一句；无需改变核心结论。DBOS 优先级下降的单句放在 LangGraph 小节内稍打断阅读，可移回 DBOS 小节；纯编辑问题。

本轮工作仅为阅读、官方静态来源访问、元数据核对与本报告写入。**没有安装依赖，未启动任何候选，没有运行产品/框架/EDA测试、GUI、SSH或性能/故障实验，没有 commit。** 请求数、token 消耗与净收益未测量。通过本复核只表示报告的当前决策语义与抽查证据一致，不表示候选选型或运行验收通过。
