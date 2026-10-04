# Validation boundary

`libinsight-offline-demo@0.1.0` is a development demo Pack. It was exercised by hand (outside the
App) against the real `lib_insight` store at commit 8e3abdc on the `tsmc28-180a` kit: the `analyse`
and `report` tools ran end to end, the v1 report validated against `hima-library-insight-report/1`
through the `libinsight-insight` reader, and `git -C <root> status --porcelain` was clean afterwards.

Focused contract tests (`test/contract/libinsight-offline-demo.test.ts`) cover: the Pack loads and
validates; every `${NAME}` in a tool argv is bound by the contract or the harness; no tool, argv,
reader or pack file references the vendor extract path, `tmlib`, `edarun` or a licence; and the
report writer's output validates against the v1 schema on a small synthetic fixture.

Untested and unclaimed: the full Campaign on the App, the `n12-100` kit end to end, the LibInsight
integration spec surfaces (LEF/pin-access, Design-specific, interactive navigation), and any
library-release decision. This Pack is for a customer demo only.
