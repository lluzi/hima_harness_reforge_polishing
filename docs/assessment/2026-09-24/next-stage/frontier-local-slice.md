# #52 本地前沿切片：Workshop 诊断与 DTCO Pack 作者输入

本切片只使用当前 polishing 工作区、真实本地 Host、隔离 Python runner 和冻结夹具；没有调用 Claude Code、模型、SSH、XTop、QuaLib 或商业 EDA，也没有切换许可证。用户拥有的 `tmp/` 未修改。

| Issue | 原行为和最小反例 | 当前增量 | 已运行的验证 |
| --- | --- | --- | --- |
| #42 | 未 `begin` 的 `recommend` 只说要提供 execution identity，不能直接区分未开始与无 Workshop。 | 缺少 execution identity 的 `recommend` 明确要求先 `begin`；已开始但未声明 Workshop 的 act 仍返回原有的能力拒绝。 | 真实 Host 红：2 个相关断言失败；绿：`agent-workshop.host.test.ts` 7/7。 |
| #43 | 旧 Issue 的“总循环预算 256、变量算术非法”已与当前 512/变量算术合同冲突；正常三轮排序只经静态校验。 | 运行期执行正常排序示例；嵌套函数、非静态循环与超 512 总预算的拒绝指明源码行。安全白名单和上限数值不变。 | Python 红：3 个诊断反例失败；绿：该文件 32/32、同目录 162/162。 |
| #44 | `foundryLibrary=.lib` 且没有 `FOUNDRY_DB_FILE` 时仍生成 `FOUNDRY_DB=.lib`，DC 到后面才报 DB-1。 | 在 `bind-inputs` 发布 `inputs.json` 前拒绝这个输入，保留显式 `.lib`/`.db` 双绑定及既有直接 `.db` 兼容路径。开发 Pack 更新为 5.2.13，未 seal。 | Pack 合同红：25/26；绿：26/26；与 Workshop 组合 Host/Pack：33/33。 |

这些结果证明本地合同，不证明 Design Compiler 实际接受给定二进制库，也不证明 Pack 的 Fmax 收益。#44 的一次有界真实 DC 串联检查仍应在用户恢复真实工具试验、确认 Site 与许可证后单独进行。Pack 知识字节已变化，一次小型真实模型作者资格测试也仍待执行；两者都不能由本地回归冒充。XTop 和 QuaLib 的许可证模式互斥；本切片没有占用任一种模式。

开发复核按用户选择使用 GPT-6 Sol / high；两个独立审查分别检查仓库标准与 Issue 规格。复核指出的未等待文件断言、未知 execution identity 与顶层函数误诊已补反例并修正。产品模型调用为 0；开发 token/成本在当前工具中不可按本切片可靠计量。
