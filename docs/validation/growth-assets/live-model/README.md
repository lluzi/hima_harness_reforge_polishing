# 有限真实模型闭环与截止复核

产品基线：`189577f9d939458a1e23edb84c30500bc6941b6a`。DeepSeek V4 Flash，同一个原生对话 owner；一个 Host、零 Electron、零新增 EDA 作业。输入为此前已准入的 AES 实际产物有限样本，SHA 在审计 JSON 中。

第三次真实运行 `run-5a30d37d-b778-4fdb-a908-29850121f465` 达到 `ended-goal-met`：先读取两个实际执行的负结果基线中的已归档上下文，编写并执行数据驱动 Python 算法，实际 Reader/Judge 得到 score=21、selected=2、conflict=0，再添加一次重读/Judge 支路并返回参考节点，提交带来源的分析与限制，完成 Pack 内归档。历史结果标为 test/limited-background，不当成当前测量。原输入和参考方法未改变。

原 harness 验收脚本整体为 **failed**，原证据未修改：最后的断言错误地读取只存在于进程内的 `result.value`，原生 trace 实际只有 `result.content`；此外异步确定性归档在截止后的合法收尾不能被当成新研究写入。`audit-growth-assets.py` 对原始 SHA 绑定的留存快照独立复核：过期 Run 的唯一 analyze 被拒绝、无新业务写入、前后 Run 状态一致、同一对话仍回答，全部通过。原始完整 trace 和客户输入保留在忽略目录，不提交到 GitHub。

`revalidation.json` 是新的离线验收结果，**不是重新跑过模型**，也不改写 `attempts.json` 中的原始失败。后续 live 脚本已改为读取 wire content，且允许 archive/experience 确定性收尾。实际新脚本未再调用模型。

三次投入按 `attempts.json` 分列：首次 fixture 错误触发模型；第二次暴露 test→test 负知识未自动复用、模型手工填写增长身份困难；修正后第三次完成业务。模型 request steps 分别 2、65、54，第二次包含被预算拒绝的一步；实际 HTTP 重试数和 token 未测量，不把这些步骤等同 API 计费次数。

`subset-audit.json`：原执行算法字节不变，移除一个原选中候选后再运行一次，与独立枚举 2,016 组的最优 score=21 对齐，原始输入/结果未改变。额外 0 模型、0 EDA、1 本地算法、1 Reader。这只能支持这个有限样本和改变子集上的行为，不能推出通用最优性、Fmax/PPA 提升、完整 DTCO pilot 或工程师团队替代成本。

分析明确列出跨 Run 工具/环境可比性未知、有限样本/预算限制，并建议改变候选集合与另一个独立样本。自由文本仍是解释；数值、引用、算法和实际读入来源独立保留。
