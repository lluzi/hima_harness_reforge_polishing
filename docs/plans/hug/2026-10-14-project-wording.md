# HUG: "Project", not "Campaign" — changed strings (slice D)

Date 2026-10-14. User decision (2026-10-14): every HUG demo says "Project", not "Campaign", in
anything a person reads. Reference: demo commit `5ecf524e` and its locale dictionaries' English
strings. Scope: user-visible text only — client labels, tab/section titles, buttons, empty states,
tooltips, and the Guide/Campaign-agent prompt sentences in `index.ts` that tell the agent how to talk
to the person. Identifiers, types, routes, file names, log/diagnostic text, tool names and Pack
contract keys keep "Campaign" (e.g. `hima/campaign.yml`, `CampaignFile`, `campaignId`,
`data-hima-control="studio-mode-campaign"`, `identity.campaignWorkspace`).

## Client strings changed

`packages/harness/src/client/ConfigurationPage.tsx`
- `Campaign configuration` → `Project configuration` (page heading)
- `Choose a HimaPack to begin Campaign preparation.` → `… begin project preparation.`
- placeholder `Untitled Campaign` → `Untitled project`; `ariaLabel="Campaign name"` → `"Project name"`
- `Reading the Campaign file…` → `Reading the project file…`
- `Import these documents as current knowledge for this Campaign: …` → `… this project: …` (drafted chat message)
- `Every check passes; confirming creates the Campaign.` → `… creates the project.`
- `Starting Campaign…` / `Confirm and start Campaign` → `Starting project…` / `Confirm and start project`

`packages/harness/src/client/Diagnostics.tsx`
- `Choose a Campaign to see its diagnostics.` → `Choose a project to see its diagnostics.`
- `Owned by Campaign Agent` → `Owned by the project agent`
- `Open Campaign Agent` → `Open the project agent`

`packages/harness/src/client/FabricCanvas.tsx`
- button text `Open Campaign Agent` → `Open the project agent` (non-owner attention gate)

`packages/harness/src/client/FabricNode.tsx`
- SVG tooltip `<title>awaiting the Campaign Agent</title>` → `awaiting the project agent`

`packages/harness/src/client/HimaWorkbench.tsx`
- mode tab `Campaign` → `Project`
- `aria-label='Campaign on this host'` → `'Project on this host'`
- `Select a Campaign` → `Select a project`
- `Start another Campaign` → `Start another project`
- insight report label template `` `Campaign Experience · ${run.id}` `` → `` `Project Experience · ${run.id}` ``

`packages/harness/src/client/InsightView.tsx`
- `Campaign Experience report` → `Project Experience report`
- `creates no Campaign, Job, analysis, or model call.` → `creates no project, Job, analysis, or model call.`
- `No retained report candidate is visible from the last Campaign view.` → `… last project view.`

`packages/harness/src/client/HimaRunCard.tsx`
- `The Campaign Agent handles business decisions.` → `The project agent handles business decisions.`
- receipt button `Open Campaign` → `Open project`

`packages/harness/src/client/Masthead.tsx`
- `Owned by Campaign Agent {id}` → `Owned by the project agent {id}`
- `Open Campaign Agent` → `Open the project agent`
- fallback title word `'Campaign'` (no pack loaded) → `'Project'`

`packages/harness/src/client/WorkMemoryPanel.tsx`
- `… for this exact {Guide|Campaign} scope.` → `… {Guide|project} scope.`
- `No verified experience candidate is available for this Campaign.` → `… this project.`

`packages/harness/src/client/TeamPanel.tsx`
- `No child task has been delegated from this Campaign.` → `… this project.`
- `This retained task is read-only because the Campaign has no current owner control.` → `… the project has no current owner control.`

`packages/harness/src/client/NodeCard.tsx`
- `Owned by Campaign Agent` → `Owned by the project agent`

`packages/harness/src/client/CampaignChip.tsx`
- tooltip `` `Campaign — ${said}…` `` → `` `Project — ${said}…` ``

`packages/harness/src/client/CampaignTab.tsx`
- `No verified evidence has been recorded for this Campaign yet.` → `… this project yet.`
- `aria-label="Campaign views"` → `"Project views"`
- `… this Campaign ran; the reference graph cannot be shown.` → `… this project ran; …`

`packages/harness/src/client/SettingsSection.tsx`
- `Reading the current Campaign file…` → `Reading the current project file…`
- `… attached to the current Campaign.` → `… attached to the current project.`

`packages/harness/src/client/index.ts`
- AuthoringCard: `Begin with /hima-grill. Campaign and Files remain beside the conversation.` → `… The project and Files remain beside the conversation.`
- `CampaignTabTitle`: rendered prefix `'Campaign ·'` → `'Project ·'`
- `WorkbenchEntry`: `title`/`aria-label`/visible label `Campaign` → `Project` (`Choose a workspace and session to open the project`, `Project — beside the conversation`, `Open the project beside the conversation`)
- sidebar description `Campaign and Data Insight beside the conversation, with source-linked evidence.` → `Project and Data Insight …`

## Guide/Campaign-agent prompt wording (`packages/harness/src/index.ts`)

Added one sentence to both role instructions in the `hima:inventory` system-prompt context (the
execution-owner and the Guide role), after the existing hima_chart guidance:

> Call it a "Project" when you talk to the person — "Campaign" stays the internal word for tool
> names, ids and records.

No other prompt text, tool name, record field or log line changed.

## Pack knowledge — investigated, nothing changed

Checked `packs/agentic-timing-closure-system/knowledge/*.md`, `packs/libinsight-analysis/knowledge/*.md`
and `packs/mage-scribe-placement/knowledge/*.md` (plus each Pack's `INTENT.md`) for a sentence that
instructs an agent how to address the person, the role AndesCell's
`knowledge/design-notes.template.md` plays (`In chat, say "Project", not "Campaign", and do not
discuss the Pack's own status or test stage.`). None of the three exists: every "Campaign" occurrence
in their knowledge is the workspace/identifier sense (`identity.campaignWorkspace`, "Campaign
workspace", `budget-campaign-01`, `example-campaign-plan.md`) read by a resident worker or a Reader,
never prose a person reads in chat — ATCS's and mage-scribe-placement's resident roles never address
the person at all, and libinsight-analysis's playbooks are the same resident-worker genre. Per the
plan's own rule, that usage stays "Campaign"; there is no existing address-the-person instruction to
align, and writing a new one would be inventing wording rather than aligning it. Flagged here rather
than silently skipped.

## Tests updated for the new strings

- `test/contract/unified-workbench.test.ts`: `d.wait('studio', 'Campaign configuration', …)` →
  `'Project configuration'`.
- `test/contract/*.desktop.test.ts` (`agent-execution`, `campaign-graph`, `campaign-refresh`,
  `campaign-workspace` ×3, `pack-owner`, `site-rediscover`): same `'Campaign configuration'` →
  `'Project configuration'` wait text (not run here — desktop group — but left consistent).

No test asserted any of the other changed strings (verified by grep across `test/`).
