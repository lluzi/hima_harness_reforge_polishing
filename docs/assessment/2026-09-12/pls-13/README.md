# PLS-13 / #14：方法身份与客户运行资产

基线：`4d8bc8c9b1e1f1205eb7725ac14ee89386cdd3f2`。工作分支：`codex/pls13-method-assets`。所有改动与验证在 polishing 的独立 worktree；两个源项目只读。按已约定的真实文件接口与真实 Host seam 执行 TDD；独立复核与主线合入由集成任务完成。本记录不声称真实模型、EDA 或桌面验证通过。

## 反例与根因

`01-seed-red.log` 是修改前的真实文件反例：在隔离 home 中第一次 `seedLocalSite` 后写入 `run-assets/run-isolated-evidence/report.md`，再次 seed 后读取报 `ENOENT`，退出 1。样本为明确标记的合成研究报告，含 NUL/UTF-8 字节；实际写入、删除及读取均由真实文件系统完成，不是 mock，也不是客户/EDA 结果。

根因是 reference Pack 和生成变体都执行递归 `rm` 后整目录 `cp`。同时原 snapshot 把 `run-assets` 当成方法文件，导致 Run、test record 和 seal 身份随客户归档变化。

`05-ownership-red.log`、`14-seal-identity-red.log.gz`、`15-directory-ownership-red.log`、`18-variant-red.log`、`22-executable-red.log` 分别记录元数据未知文件、显式 seal 方法身份、未知空目录、衍生方法误用原 seal、复制后脚本失去可执行权限的 RED；后续对应行为均在最终矩阵通过。`29-history-ownership-red.log` 进一步复现历史方法内部伪装为 run-assets 的未知文件被接纳；限制为仅根安装目录可有 run-assets 后，最终 `32` 通过。

`04` 和 `07` 是测试夹具调试失败，分别是把正常 waiting 命令当 success、只修改 contract 版本而没修改 graph 版本；不作为产品缺陷证据。`08` 在正确版本夹具上记录旧 resume 路径失败；失败后的旧清理顺序使测试进程滞留，已在确认该进程 cwd 为本 worktree 后单独终止。最终 Host 用例修正先关 Host、后删除 home 的清理顺序，并正常退出。

## 最终行为与接口

- 唯一客户归档根为 `installedPack/run-assets/<runId>/`。没有第二归档树。`snapshotPackFolder` 对该树与隐藏条目继续做文件种类检查，但不读取客户文件字节，也不把它们放入方法 map。Run/test record/loader/check/release/install 都从该 map 派生。方法 digest 保持既有 `path + SHA-256` 格式，排除五个 authoring record；seal 仍覆盖 authoring record，并在新 `VERSION.yml` 写出与 Run 相同的 `methodDigest`。
- 旧 method-only seal 继续验证；旧 seal 若把 `run-assets` 混进方法清单则明确拒绝，不伪造旧 Run 的身份。文件权限复制用于保留脚本可执行性，字节 digest 不新增权限字段。
- `installPackMethod({ from, to })` 写 `.hima-method-install.json`，记录 Pack/version/digest 与完整方法文件 hash 清单。只删除/替换验证为其所属的列明文件；目录只在为空时用 `rmdir` 删除，绝不递归删除客户目录。更新前后方法保留在 `.hima-method-history/<digest>/<packId>/`；历史 manifest 同样校验。`run-assets` 原地保留，不搬运、不重拷。
- 安装以 packs 目录下的专有 lock 序列化；实际文件替换前写 `.hima-method-update.json`，保留 previous/next manifest。半更新 loader/再次安装拒绝。snapshot 同时检查 marker 与前后安装 manifest inode，拒绝跨一次安装读出的混合视图。
- 同版本不同方法内容拒绝，需要新版本。未知文件、隐藏元数据中的未知文件、未知空目录、无可验证归属的旧目录拒绝。没有 installer manifest 的旧安装仅在完整方法字节与源一致时接纳；对不一致的旧安装保持保守拒绝，包括需要人工迁移的旧发布目录。
- `exportPackMethod({ from, to })` 只按验证后的方法清单写一个新目录，不先整目录复制再删敏感文件。已安装目录出现未列明文件时拒绝导出。生成的本地变体清除 source 的 authoring/seal 记录，因为新方法未经过原方法的测试。
- `preservePackMethod(folder)` 保存 Run 实际使用的方法；`loadRunPack(packsDir, id, digest)` 按原 digest 取验证过的保留版本。若没有历史副本，仅在当前方法与已记录 digest 一致时保留并使用；无 digest 或不一致均拒绝。start、resume、reconciliation 和 HimaJudge 使用此路径，当前安装升级不能替换旧 Run 的 graph/rules/scripts。
- `workspace.json.pack.digest` 和 Ledger WorkspaceRecord.packDigest 写入新的 preparation。旧记录保持可读，但缺失身份不能证明可复用。原有 copy-list 差异仍优先给出具体缺少文件说明。

目录穿越与用户控制的 symlink 均拒绝。macOS 的 `/var`、`/tmp`、`/etc` 仅在实际链接目标恰为对应 `/private/...` 系统目录时接受；其下客户目录的链接不接受。既有 snapshot 对同权限进程恶意并发改写目录的限制不变。保留的是 Pack 方法；未冻结 Harness 软件版本或 Site 输入/环境，后者仍由其相应任务负责。

## 实际验证

Node `v24.20.0`；依赖执行 `pnpm install --frozen-lockfile --store-dir <polishing>/.hima-tmp/pnpm-store`，首轮 11.8 s，包/lock 增量后再安装 1.6 s。没有修改全局 pnpm 配置。pnpm 11 的 `run` 自动依赖检查曾触发无 TTY 的 purge 拒绝；在已完成 frozen-lockfile 安装之后使用 `pnpm --config.verifyDepsBeforeRun=false run ...` 运行原有 build/typecheck，未绕过编译或类型检查。desktop 新增正式 workspace dependency，使全新递归 build 先产出 harness 导出类型。

| 记录 | 结果 | 成本/范围 |
| --- | --- | --- |
| `30-final-build.log`、`31-final-typecheck.log` | 退出 0 | 新源码 build 和全仓 typecheck |
| `32-final-assets.log` | 8 pass / 0 fail / 0 skip；退出 0 | 8.365 s；1 in-process Host、0 Host subprocess/Electron/SSH；含最终历史目录未知资产边界 |
| `25-final-matrix-pipeline.log` | 11 pass / 0 fail / 0 skip；退出 0 | 36.981 s；25 in-process Host、0 Host subprocess、0 Electron、0 SSH 尝试 |
| `21-corrected-legacy-cases.log` | 4 pass / 0 fail / 0 skip；退出 0 | 2.776 s；仅四个发生 fixture/diagnostic 变化的既有用例 |
| `13-regression.log.gz` | 109 pass / 6 fail / 0 skip；退出 1 | 334.338 s；115 相关用例，117 in-process Host、3 Host subprocess、0 Electron/SSH |
| `20-final-matrix-pipeline.log` | 10 pass / 0 fail / 0 skip；退出 0 | 34.166 s；后续新增 executable 案例与 pipeline 真实归档校验后由 `25` 复验 |

初轮 115 用例的 6 个失败没有省略：四个是两个 synthetic Run 缺 digest、workspace 精确结构新增 digest，以及方法身份提示掩盖原 copy-list 具体提示；最后一项修正产品诊断顺序，前三项更新 fixture/assertion。另两个是执行期间新增但尚未构建对应实现的 seal/空目录 RED，不能算最终源码回归结果。没有重跑完整 local suite；集成任务在合入各工作分支后统一运行。`25` 对矩阵与原 pipeline 文件重新构建并执行；最后仅收紧历史方法内部的未知资产拒绝，`30`/`31` 再构建和类型检查，`32` 再跑完整资产矩阵。

最终矩阵包括 reference/variant 连续 seed 后相同字节与 SHA、同版本冲突、普通/隐藏未知文件和空目录、legacy 无身份拒绝、symlink/目录穿越、方法-only export、脚本可执行性，以及通过 `chmod` 使真实方法文件删除返回 `EACCES` 的中断更新。中断后原资产内容不变，部分安装拒绝，而原方法可通过原 digest 读取。

pipeline Host 用例在实际 test Run 完成后加入客户归档，再通过真实 `/hima pack check` 校验 TEST 记录并 release；新 seal.methodDigest 与该 Run 的 digest 相等，原有完整 seal 文件列表断言仍在，因此客户归档没有进入 seal。replay 只提供协议响应，并不证明模型研究能力。

未运行 L3/Electron、真实模型、真实 SSH Site、EDA、完整 pilot；本切片没有改变启动/错误界面。没有把测试 fixture 声称为真实客户成果。

## 旧断言去向

原有测试未删除。`fabric-restart` 的无状态 Run fixture 增加 current startRun 已写入的 digest，保持原 `never-started`、无 Job 与等待语义。`judge` 的缺失原方法 fixture 记录真实原 digest，错误断言改为该原身份不可取得，保持不写 verdict、不回退 bundled rule。`pack` 的 preparation 精确对象增加 digest，原 copy-list 断言保持。`pipeline-stages.host` 追加归档/test/release 身份断言。新文件加入 local group；桌面组及 live-site 文件未迁移。

## 回滚与中断修复边界

不得回退到旧的递归删除 Pack 的 seeding。需要回滚运行代码时先禁用旧 seeding，保留整个 installed Pack，包括 run-assets、历史方法与 previous/next manifest。

半更新没有自动修复或静默完成：先确认没有仍在执行的 installer，保留 marker/lock 与现有目录；从 marker.previous.digest 对应的历史目录验证并导出原方法到独立新位置，人工核对原方法清单和中断现场后，只恢复清单中的方法文件与原安装 manifest。不能删除、覆盖或从源 Pack 重新生成 run-assets；不能仅删 marker 使部分安装冒充完成。首次安装没有 previous 方法时保留现场，选择新安装位置。方法历史目录与 marker 的存在使这一步可审查，但本切片未新增自动修复命令或资产服务。

含原始尾部空白的 TAP/RED 输出与 implementation.patch 以 `.gz` 保存，解压后为原字节；没有为通过 whitespace check 改写诊断内容。source-hashes.json 记录本次所有代码/测试改动文件的 SHA-256。
