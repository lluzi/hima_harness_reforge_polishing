# 本地运行与故障恢复

HimaHarness 的编排、PostgreSQL 和 App 在本机运行。现有 DeepSeek 模型 API 和获准 Site
连接仍是业务依赖。一个 Home 由一个 Host 拥有；退出顺序是停止接纳、收束本次工作、关闭
DBOS/连接池，再停止私有 PostgreSQL。数据库不可用时不会回退旧 Fabric 调度。

## 升级边界

保留原 App、Home 和方法原件。活动旧 Run 必须先用其原 App 正常收束；不能将旧 Ledger
转成 DBOS checkpoint。历史记录继续由历史读者读取，新 Run 使用 DBOS。活动 DBOS Run
要求原冻结可执行版本；不要通过改 applicationVersion 或 PG_VERSION 强行打开。PostgreSQL
major、平台或固定运行时字节不匹配时保留数据，使用原分发物检查与恢复。
已经结束的 DBOS 历史保留原 applicationVersion，可以与升级后的新记录一起备份；
待执行的工作流和没有当前修订终态的 Run 仍要求原可执行版本，不能靠历史版本混用绕过。

## 冷备份与恢复

离线 API 从已安装 Harness 的 `@hima/harness/run-backup` 子路径导入，避免加载 Host：

```js
import { createColdBackup, retireSource, restoreColdBackup, qualifyHeldRestore,
  inspectColdBackup } from '@hima/harness/run-backup';

const options = {
  home: '/absolute/original-home',
  destination: '/absolute/new-backup',
  runtimeDirectory: '/absolute/bundled-postgres',
  distribution: {
    root: '/absolute/HimaHarness.app', // Linux: /absolute/HimaHarness
    manifestFile: '/absolute/trial-manifest.json',
    harnessRoot: '/absolute/resources/app/node_modules/@hima/harness',
  },
};
await createColdBackup(options);
await inspectColdBackup(options.destination);
```

Mac 的 harnessRoot 位于 `Contents/Resources/app/node_modules/@hima/harness`。
使用分发物自带 Node 运行保存的 `.mjs` 脚本，路径必须指向本次完整分发物及其旁边的
manifest。先正常退出原 Host；有活 Host、PG、外部 Job、未关闭租约、缺失引用材料或
未保留的 SSH 材料时不能形成完整冷备份。备份包含整个停止的 PGDATA、应用/DBOS/datasource/
outbox、Home、完整分发物及引用文件。失败留下私有 partial 目录，不能作为完整备份使用。

恢复始终先 hold，不启动 Host、模型或 Job：

```js
await restoreColdBackup({ backup: '/absolute/backup-A', newHome: '/absolute/new-home' });
```

普通备份不能证明原 Home 在备份后没有继续运行。仅核对旧备份内 Job A 已完成，也不能
解除 hold。原 Home 仍可操作时，用同一机器、同一用户执行最后一次完整备份并退休源：

```js
await retireSource({ ...options, destination: '/absolute/final-backup-B',
  targetHome: '/absolute/new-home' });
await qualifyHeldRestore({ newHome: '/absolute/new-home',
  retiredBackup: '/absolute/final-backup-B', harnessRoot: options.distribution.harnessRoot });
```

资格依赖两个 Home 外的私有 `~/.hima/database-lineages` 退休记录、最新完整快照和原 effect
收束证据。整个旧导入被较新快照替换，不合并 checkpoint；旧导入保留为 previous 目录。
原源 Home 不再能成为写者。冻结的原绝对材料路径只在不存在或字节相同时恢复；冲突保持
hold。原工作目录丢失时，先从已核验的最终备份检查原进程与会话是否仍活跃，再在 hold 下
恢复材料并校验原收束凭据；解除 hold 前再次检查物理收束。不能手改 hold/lineage 回执或删除权威目录来绕过。跨机器、旧版未受控源丢失、原源
已丢失且没有最终退休快照，均只能离线检查，不能证明可安全续跑。

## Native candidate packaging

The existing packager runs on its target platform. It produces `HimaHarness.app` on macOS arm64,
with `Contents/Resources/app`, or a `HimaHarness/` directory on Linux x64, with `resources/app`.
Both carry the Desktop, deployed production npm dependencies, Node24, PostgreSQL16.15 `bin/lib/share`,
profile and Pack assets. Customer startup uses bundled Node/PG and needs no developer checkout,
global Node/PG or Docker. Linux requires a desktop session and working Electron sandbox/user namespaces;
do not add `--no-sandbox`. The retained Linux Docker userspace tests are emulated x64 on a Mac, not
native Linux hardware or a new nonadministrator account qualification.

Ordinary trial release packaging requires one clean committed source snapshot. The explicitly
internal U10 candidate may freeze the owned U9 changes by their full product-source file inventory
and digest; it records dirty provenance and checks equality before and after building/staging.
Unrelated .lstack/research and ignored generated build outputs are outside that source inventory.
Use the repository's usual pnpm build, then run the
existing script with matching native inputs:

```sh
node scripts/package-trial.mjs --output /new/candidate-directory \
  --postgres-prefix /native/postgresql-16.15 \
  --postgres-build-manifest /retained/postgres-build.json \
  --node-build-manifest /retained/node-build.json --node-archive /retained/node-native.tar.xz \
  --electron-build-manifest /retained/electron-build.json --electron-archive /retained/electron-native.zip \
  --notice-materials /retained/upstream-notices/notice-materials.json \
  --internal-candidate
```

On macOS the Node archive suffix is `.tar.gz`. Native Node/Electron identity JSON fields are `version`,
`source` (the fixed official archive URL) and `sha256`. The Node binary and LICENSE are checked against
its archive; the Electron executable/framework or Linux executable/ffmpeg library and both notice
files are checked against the pinned44.2.0 archive. PG uses its existing pinned official-source build
identity and staging link checks. Ordinary packaging rejects tracked dirty source and untracked product
inputs; the explicit internal candidate instead binds all actual product-source bytes, rebuilds shipped entry points, stages native bytes, inventories dependencies, verifies hashes,
and runs the packaged headless Host/Pack/knowledge smoke. Build-time tools (pnpm, compiler, native
link-audit tools, tar/unzip) are developer packaging dependencies, not customer install requirements.

`--internal-candidate` is only for the ATCS0.4 development method awaiting actual U10 acceptance.
It permits TEST.md without VERSION.yml only when the ATCS contract says `development`; an invalid
existing seal is still refused. Manifest purpose is `internal-u10-candidate`, stage is `development`,
and status explicitly says not released or accepted. Ordinary packaging preserves release-seal checks.
Neither path is commercial publication or legal clearance.

`--verify /path/to/native-artifact` checks the manifest and same-platform packaged runtime without
opening a window. `--verify-desktop /path/to/native-artifact` explicitly performs the frozen-candidate
isolated Home, obsolete Home refusal, local Site installation and reopen smoke with a real desktop.
On macOS use the designated Catsights screen. Missing screen/account/native hardware is BLOCKED or
NOT RUN, never PASS. Move the whole distribution before the separate installer acceptance; record
ordinary nonadministrator startup, exit, reopen, retained Home behavior and zero-process teardown.

`trial-manifest.json` binds source, App/Harness/SDK/Electron/Node/PG/Pack identities and the complete
artifact file hashes. `resources/app/third-party/SBOM.json` (Mac: `Contents/Resources/app/...`) lists
actual deployed npm roots, lock integrity, package.json and license hashes, native dynamic links and
Sharp libvips embedded component versions. Preserve Node/Electron/Chromium aggregate notices,
`postgres/COPYRIGHT`, npm license files and `third-party/THIRD_PARTY_NOTICES.md` when copying the kit.
Native final-byte hashes come from the final signed artifact manifest, avoiding circular SBOM/signature
hashes. Missing notices, LGPL native-source/relinking obligations and incomplete embedded-license
identification are enumerated findings. See root THIRD_PARTY_NOTICES.md; no zero-risk or complete
whole-system SBOM claim is made. Actual vendor-network denial, model/Site traffic and frozen App
operation are separately tested by the delivery operator.

Supplemental upstream notices use a source-bound `hima-notice-materials/1` manifest. Each exact npm
name/version must match its deployed lock integrity; each retained local notice must match its hash
and upstream URL. The packager copies those files and records their identities, rejecting foreign
package integrity, changed bytes and escaping paths. Supplemental notices are materials for review;
they do not silently approve native corresponding-source or library-replacement obligations.
