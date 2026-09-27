# ATCS-07 — Bounded HimaHarness Campaign 与 Pack 交付

状态：blocked-on-ATCS-06  
依赖：ATCS-06  
产出：`PACK_DELIVERABLE`

## 测试主体

使用 HimaHarness Desktop 和现有 human-like tester 工作流。Claude Code 是唯一 GUI/HimaHarness
Operator；开发 Agent 不同时操作 HimaHarness/Catsights。只创建一个新 Campaign、一个持久 Run、一个
owner。历史 Runs 保持不变。

## Bounded journey

1. 启动精确 App/Home，Guide 解释 Pack、Site、输入、Goal、post-route-only 限制和下一步。
2. 完成 Preparation 后一次确认创建 Campaign/Run；Guide 保持独立。
3. baseline observation/physical/risk/residual 形成 reader-backed 当前状态。
4. plan 产生三个有界 work packages。
5. 三支 Pack Team 依次完成实际 Researcher、Reviewer adoption、资源感知 Operator、Operator adoption
   和 Contribution；无 XTop seat 时排队，不复制 Run。
6. collect/composition/replay/presta 形成一个 joint candidate 或诚实拒绝。
7. 若 candidate 合格，执行一次 Innovus/StarRC/PT/physical/evaluation；否则以 reader-backed blocker
   结束该 bounded slice。
8. adoption 保留 working/best/delivery 差异，record-experience 写入成功或失败条件。
9. pause/continue、关闭/重开、切换 Guide/child transcript 不产生重复 Job/child/mutation。
10. Live Run、child transcript、report、Data Insight、Guide 对同一 Runtime facts 一致。

## PASS

PASS 只要求：

- 精确 App/Pack/Site/Permit/binding/input identities；
- Preparation、one Campaign/Run/owner；
- 三支 Team 的真实 contract/session/result/adoption；
- Contribution、composition 和候选 lineage 完整；
- 最多一次 joint physical refresh，或在此前诚实 reader-backed refusal；
- recovery 无 duplicate effect；
- evaluation/experience/ending 与事实一致；
- tester checkpoint、报告和 handoff 完整。

Setup/hold 改善、clean、elapsed 优于 control、ROI 都不作为 PASS 条件。

## 发布

PASS 后：

1. 从该 Run 生成正式 `TEST.md`；
2. native seal/release 生成 `VERSION.yml`；
3. 重新打包最终 App 并做安装、冷启动、digest、rollback/readback；
4. 发布安装说明、适用范围、已资格工具和限制；
5. 独立 reviewer 核对固定 identities 和非声明项；
6. 记录 `PACK_DELIVERABLE`。

任何 Pack/wrapper/binding 修复都回到 ATCS-06，并使用新 Campaign；不在失败 Run 上替换方法 bytes。

