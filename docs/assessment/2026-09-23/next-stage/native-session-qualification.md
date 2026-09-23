# Native Session qualification — S05 M1 / S06 C1-a

日期：2026-09-23。源码基线：`5157390604151cb2e202b27deb7ae84a36d16035`。开发配置：`gpt-5.6-terra` / medium。范围是 pinned DSH `0.1.5-alpha.1` 的公开类型、已安装源码和一个隔离真实 Host；没有模型请求、网络、EDA、Claude 或 Job。

## 结论

DSH 已提供可用于 **S06 C1-a 的最小原生会话生命周期 seam**：公开 `AgentFactory.createAgent(ownerCtx, CreateAgentOptions): Promise<AgentHandle>`，其中 `CreateAgentOptions` 有 live `parentAgent` 和持久 `meta.parentSession`、`isSeeded`、`origin: 'subagent'`、`delegationDepth`、`seed`/`inheritedEventCount`。返回的 `AgentHandle` 把 `dispose()` capability 留给创建者；live `Agent` 公开 `followup`、`steer`、`inject`、`whenIdle`、`cancel`、`session` 和 scoped `ctx`。

DSH 也提供 **S05 M1 可读的持久 session seam**：现有 `ctx.agents.resume({ resumeSessionId, agentOptions? })` 重开持久 session，`agent.session.deriveMessages()` 给出派生的 transcript，`snapshotEvents()` 给出事件快照。仓库的 `test/contract/support/boot-inprocess.ts:resumeTestAgent`、`readPersistedSession`、`systemPromptOf` 已将它们包在 ADR-0001 的现有 seam 中。

这不资格化持久摘要写入、SessionQuery、compaction 触发/保留期、跨 Host child lookup、预算分摊、工具隔离或有效权限。类型中的 `inject()` 仅是下一 pre-step 的易失上下文，取消/处置可以丢弃；它不是 memory carrier。没有公开证据时不得直接写 DSH event/log，也不得用 daemon 补洞。

## 静态能力矩阵

| 需求 | 公开 evidence | 状态与可用边界 |
| --- | --- | --- |
| 创建 root/child | `@deepseek-ai/dsh-agent/lib/types/index.d.ts:CreateAgentOptions`, `AgentFactory.createAgent` | **可用 seam，未在本资格测试直接调用 factory**；当前 Hima 用 `ctx.agents.create` wrapper。child 实现须从现有 wrapped seam 接入，保持 ownerCtx/handle ownership。 |
| parent lineage | `parentAgent`; durable `meta.parentSession`, `isSeeded`, `origin`, `delegationDepth`; optional completed-turn `seed` | **本次真实 Host 已验证 create/restart 后 metadata 与 runtime ownership**；仍未验证 restart lookup/idempotence。C1-b 前仍需后者。 |
| 生命周期与停止 | `AgentHandle.dispose`; `Agent.cancel`; `whenIdle` | **部分可用**；dispose 是创建者 capability。cancel 的 delivery/result receipt 不是 C1 的业务完成回执。 |
| follow-up / transient context | `Agent.followup`, `steer`, `inject` | **可用但易失**；`inject` 不唤醒且可能被 cancel/dispose 丢弃，不能放 S05 摘要。 |
| transcript/readback | `Agent.session.deriveMessages`, `snapshotEvents`; native `resume` | **可读 seam**；只能投影实际保存的消息/事件，缺失历史必须显示不可用。 |
| persistence/reopen | `AgentRegistry.resume` 和 `ResumeAgentOptions` | **本次真实 Host 已验证**无消息 root/child 的跨 Host read-only resume；不是 compaction/retention 证明。 |
| SessionQuery | pinned `@deepseek-ai/dsh-session-query` 公开 `readSurface/readSession/readEvent/traceSession/observeSession` | **公开读取接口存在**；本轮没有验收完整 context/transcript 展示，不得因顶层 node_modules 未挂包误报接口不存在。 |
| compaction / retention | lifecycle type `SessionStartSource` 包含 `compact`；尚未运行带非空历史的压缩/恢复测试 | **未资格化**；本轮不依赖未经验证的压缩后写入/保留语义。 |
| effective model | live `agent.options`; resume 需显式 `agentOptions` 才能驱动 turn | **本次真实 Host 已验证**：root/child resume 回读显式 effective provider/model；没有模型调用。 |
| effective tools / permissions | scoped `agent.ctx` 和 create/resume `setup` 文档 | **未资格化为安全 delegation boundary**；setup 是 trusted same-process composition，不能替代 Hima/Site Permit/guard。 |
| budget | `CreateAgentOptions` 无 Hima budget share | **不支持为原生事实**；S06 必须让 Fabric/Ledger 继续拥有总预算和 receipt。 |

## 真实 Host qualification

新增 `test/contract/native-session.host.test.ts` 用 `createHimaHome()` 和 `bootInProcess()` 启动真实 Hima profile 的隔离 DSH home。已执行的测试：

1. 以现有 `createRootAgent` wrapper 创建一个 root，读取实际 `agent.options` 和 session cwd；不调用 `followup`，所以没有模型请求。
2. 关闭该 Host，重新启动同一隔离 home。
3. 通过现有 `resumeTestAgent` 重开同一 session，并断言 id、显式 effective model、cwd 和空 transcript；随后 `AgentHandle.dispose()` 后 registry 为零。

第二个场景通过既有 wrapper 调用 `agents.create`，显式给 child `parentAgent` 和 durable `parentSession/origin/delegationDepth`，检查 runtime ownership、重启后的 header 和默认空 transcript。它不发送 model turn。`pnpm run test:local --files test/contract/native-session.host.test.ts` 在 Node 24.20.0 通过：2/2，4.206 秒，4 个 in-process Host、0 Electron、0 SSH。测试只能证明最低的 persistence/reopen、readback、lineage 和 handle disposal。它不能证明 compaction、消息/工具 transcript、权限、预算、模型质量或跨进程通知。

## S04 / S05 / S06 最小接线建议

```ts
// S04: only a Host-resolved address and a real session id enter a handoff.
type GuideToChild = { parentSessionId: string; target: TargetAddress; sourceRefs: string[] };

// S05: reopen, derive, then re-read Hima authority; never write session events.
const handle = await ctx.agents.resume({ resumeSessionId, agentOptions: effectiveModel });
try { const transcript = handle.agent.session.deriveMessages(); /* references only */ }
finally { await handle.dispose(); }

// S06: implementation must use the existing wrapped creation boundary.
// It carries parentAgent + meta.parentSession/origin/delegationDepth and retains AgentHandle.
// Fabric/Ledger separately checks owner, pause, budget, Site permit and result adoption.
```

The shown snippets are integration direction, not production API additions. `origin: 'subagent'` is lifecycle metadata, not human authority; no child result changes a Run without existing Fabric/Judge checks.

## Hima carriers that remain authoritative

- `Ledger` (`RunRecord`, control, observation, archive/knowledge records) remains the source for Run, owner, pause, budget and measured results.
- `workshop.ts:knowledgeForWorkshop` and Pack archive remain source-linked knowledge carriers.
- `experience.ts` remains the source for experience/asset candidates and their conditions.
- Session transcript can explain what was exchanged; it must not replace these facts.

## Next gate and rollback

M1 can now assign a narrow follow-up to inspect actual `dsh-session`/compaction query and retention APIs, then add a real message/compact/reopen counterexample only if a documented public interface exists. C1 can separately qualify one parent/child creation and restart lookup through the existing wrapped Hima seam. Neither authorizes production wiring yet.

Rollback is deletion of this isolated test and assessment document. It creates no persistent user asset outside the test's disposable home and changes no production code.
