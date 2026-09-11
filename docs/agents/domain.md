# Domain Docs

## Layout

采用 single-context：

- 根目录 `CONTEXT.md`：共享领域词汇。
- 根目录 `docs/adr/`：本仓库的架构与工程决策。

Harness 与 Desktop 共用这些文档，不因技术分包拆分领域上下文。

## Before exploring

探索代码前阅读根目录 `CONTEXT.md`，
并阅读 `docs/adr/` 中与当前工作相关的决定，注意其状态。

若领域文档缺失，继续工作，不主动搭建空文档结构。
术语或决定实际得到澄清时，由 domain-modeling 按需维护。

## Vocabulary

Issue、设计、假设和测试名称中的领域概念使用 `CONTEXT.md` 的定义，
避免使用其明确排除的同义词。

遇到未定义概念，先判断是否有必要引入；
确有领域缺口时记录给 domain-modeling。

## Decisions and provenance

与现有 ADR 冲突的建议必须指出对应 ADR、冲突内容及重新讨论的证据。
区分 proposed 与 accepted，不把提案当作已经接受的决定。

`docs/upstream/` 内的词汇和 ADR 属于对应 prototype 快照；
引用时注明来源，不与 polishing 的同号 ADR 混用。
