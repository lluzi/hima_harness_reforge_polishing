# Issue tracker: GitHub

本仓库的任务与任务规格存放在
`lluzi/hima_harness_reforge_polishing` 的 GitHub Issues，使用 `gh` 操作。
产品定义、领域词汇和 ADR 仍以仓库内对应文档为依据，Issue 引用它们。

## Conventions

操作时显式指定 `--repo lluzi/hima_harness_reforge_polishing`：

- 创建：`gh issue create --repo lluzi/hima_harness_reforge_polishing --title "..." --body-file <file>`
- 阅读：`gh issue view <number> --repo lluzi/hima_harness_reforge_polishing --comments`
- 列表：`gh issue list --repo lluzi/hima_harness_reforge_polishing --state open --json number,title,body,labels`
- 评论：`gh issue comment <number> --repo lluzi/hima_harness_reforge_polishing --body-file <file>`
- 标签：`gh issue edit <number> --repo lluzi/hima_harness_reforge_polishing --add-label "..."`，移除使用 `--remove-label`
- 关闭：`gh issue close <number> --repo lluzi/hima_harness_reforge_polishing`

多行正文写入临时文件后通过 `--body-file` 提交，保留真实换行。
裸 Issue 编号默认属于 polishing；引用 prototype 的任务时带完整仓库身份或链接。

技能要求“publish to the issue tracker”时创建 GitHub Issue；
要求“fetch the relevant ticket”时读取 Issue 正文、标签与评论。

## Pull requests as a triage surface

**PRs as a request surface: no.**
