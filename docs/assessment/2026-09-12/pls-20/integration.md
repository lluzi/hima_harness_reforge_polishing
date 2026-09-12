# 三方整合处理记录

B `b4ac9d9360ad6da68b5fd2824621ba6edab7408b`；P 产品 `263a0739c45a420c158c46786fb82cea70c5ec44`；开工 HEAD `0c8f127a93a4ad933aedd9b08e10330d87868cf5`；U `ca47fa05ebe7417c23f0aebbb769db627bbf08a0`。

首次 archive 导入没有建立 Git 共同祖先。本次从源仓库只读取固定 Git 对象，在独立 `codex/pls20-step4-integration` 分支按原映射整合。24 个路径两侧都改过；实际产生文本冲突的文件为 11 个。没有使用整侧覆盖或 `--allow-unrelated-histories`。

| 重叠路径 | 处理 |
| --- | --- |
| `.githooks/pre-commit` | Retain build-before-types; add upstream boundary check; hooks not installed. |
| `package.json` | Retain build-once and explicit resource groups; add boundary check, dsh-llm and dsh-skill. |
| `packages/desktop/src/driver.ts` | Compose upstream display/focus behavior with React controlled-input setter. |
| `packages/desktop/src/local-site.ts` | Import nine-stage stand-in; retain corrected v2 Pack method, explicit simulation statement, and subsecond delay compatibility. |
| `packages/desktop/src/main.ts` | Import preset/replay/profile boot and display handling; retain UI02 conversation/Live Run shortcuts. |
| `packages/harness/src/card-labels.ts` | Compose Workshop/reader/purpose labels with polished preflight and controls. |
| `packages/harness/src/client/HimaRunCard.tsx` | Retain responsive Run controls and compact card; import Workshop/reader/purpose projection; reuse Workshop section in native dock. |
| `packages/harness/src/experience-report.ts` | Write schema 2 research/evidence limits plus purpose; schema 1 purpose stays optional; original saved bytes are not rewritten. |
| `packages/harness/src/fabric.ts` | Import pack snapshot/purpose and Workshop/resumeNode; retain per-Ledger/per-Run resume admission serialization. |
| `packages/harness/src/generations.ts` | Import session/code exclusions from generation wall time and free semantic types; keep PLS report timing correction. |
| `packages/harness/src/index.ts` | Register upstream model/authoring/skills; keep live Run list and preflight operation; compose Pack stage information. |
| `packages/harness/src/paths.ts` | Add moment route alongside existing API and unified workspace paths. |
| `packages/harness/src/remote.ts` | Merge moment/authoring records with fenced Run list and start-options; combine unstartable marks with stale-selection and static preflight checks. |
| `packages/harness/src/workbench.ts` | Preserve polished HTML form layout/preflight; import Workshop/reader/purpose and stage-labelled options. |
| `packs/opene902-timing-probe/PACK.md` | Keep PLS-04 version 2 method and worked counterexample; correct chooser location to Pack-local. |
| `packs/opene902-timing-probe/graph.yml` | Keep version 2 over-constraining binding; accept Pack-local lookup comments. |
| `scripts/acceptance-step3.ts` | Keep corrected default method description and report schema checks; import independent oracle for either explicitly selected chooser and record its origin. |
| `test/contract/fabric-restart.test.ts` | Keep polished resume fixtures; import reader recovery cases; wait for both durable node and Run transitions before asserting final state. |
| `test/contract/fork-join.test.ts` | Compose upstream Pack-local variants with polished v2 method identities. |
| `test/contract/honest-standin.test.ts` | Keep real HTTP Host method matrix; import Pack chooser origin assertion without restoring Electron dependency. |
| `test/contract/loop.test.ts` | Compose Pack-local variation with corrected default method and v2 expected identities. |
| `test/contract/pack.test.ts` | Use upstream reordered cases, retain prior live-site split, reapply v2 identities and explicit legacy chooser variants; release misversion negative uses 3 vs 2. |
| `test/contract/support/driver.ts` | Compose replay arguments/display support with preflight-aware form helpers; record test launch costs. |
| `test/contract/support/pack.ts` | Compose Pack-local reader/Workshop/release fixtures with default v2, explicit legacy method, and two-knob chooser stored inside its variant. |

## 删除、移动与共同修正

- 上游删除 bundle 内的 over-constraining 与测试 chooser。正确方法移入 `packs/opene902-timing-probe/choosers/`；两参数测试将 chooser 放入自己生成的 Pack，不恢复全局测试方法。
- 上游 generation 投影对 Experience 时间的排除与 PLS 修正一致；新增 session/code 也不计为额外 generation。
- 原报告 schema 2 的证据判断保留，新增 purpose 写入新报告；已保存 v1/v2 的读取仍核对原 hash。
- `pnpm-lock.yaml` 由合并后的 manifest 使用 pnpm 11.25.0 重新解析，再 frozen install；没有人为选择整份锁文件作为结论。
- 上游知识、技能、报告和说明保留来源；根 AGENTS、CONTEXT、产品定义、ADR 未被源指令覆盖。
- 源项目只读校验及每条文件的 B/P/U Git blob、输入/结果 SHA-256 见 [清单](import-manifest.json)。旧导入清单保持原样。

## 回滚与格式边界

- Ledger 从 14 升至 19；沿用已有 version gate，旧 home 会被明确拒绝，**没有原地迁移**。新旧数据目录分别保留，不让旧代码打开新账本，也不让新代码重写旧账本。
- Experience v1/v2 文件保持原字节/hash 可读；schema 2 新报告仍区分执行终态与研究证据结论。
- 手写且未经过作者流程的 Pack 保持 `stage: none`/普通 Campaign；已有 pipeline Pack 按原 stage/seal 检查；正确默认 probe 的 contract/graph 均为 v2。
- 回滚代码使用开工 commit `0c8f127`（包含已交付 polish 与接续规格）；继续使用升级前保存的 home。当前独立测试 home 不合并回用户已有数据。
