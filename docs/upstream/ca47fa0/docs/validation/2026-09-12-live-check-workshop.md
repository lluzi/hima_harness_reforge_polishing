# Live check: the workshop, 2026-09-12

One real model writing one real script through the product, with a key from the launching environment (35 characters, beginning "sk-b").
HimaHarness on DeepSeek Harness 0.1.5-alpha.1 (Node v24.20.0), driven through the desktop shell in driver mode with **no replay overlay**: the host composed its own DeepSeek adapter.

**PASS** — 12 of 12 checks passed.

## What ran

- Run `run-292b43ce-1eee-4f05-a4f0-e15df944ace3` of the `workshop-probe` pack on site `local`, one generation; it ended `ended-goal-not-met`.
- Workshop `mine`, writing into `hima-workshop/mine`, entry `miner.sh`, preset `hima-moment`.
- The moment reached: ["hima_workshop_write","hima_workshop_read","hima_workshop_knowledge"].
- What the reader took out of what the script produced: [{"type":"candidate_count","value":10,"unit":"count"},{"type":"candidate_slack","value":-0.1,"unit":"ns","mode":"setup","scope":"reg2reg"}].

## What the model wrote

```sh
#!/bin/sh
# Mining stage: state how many cell candidates this synthesis left, and the
# slack they were held to, in the shape this pack's reader (count-candidates) reads.
#
#   sh miner.sh <workspace-root> <design>
#
# Count   <- the whole thousands of square microns of the post-synthesis
#            "Cell Area:" line in flow/results/<design>/syn/report/qor.rpt
# Slack   <- the "Critical Path Slack:" of the path group that report names,
#            in ns (setup pass, the one the report states).
#
# Writes flow/results/<design>/mine-timing/candidates.json

set -eu

ARG1=${1:-}
ARG2=${2:-}

# The fabric launches this with the workspace root first and the design second;
# tolerate the design being handed in alone as well.
if [ -n "$ARG2" ]; then
  WS=$ARG1
  DESIGN=$ARG2
else
  WS=$(dirname "$ARG1")
  DESIGN=$(basename "$ARG1")
fi

REPORT="$WS/flow/results/$DESIGN/syn/report/qor.rpt"
OUTDIR="$WS/flow/results/$DESIGN/mine-timing"
OUT="$OUTDIR/candidates.json"

if [ ! -f "$REPORT" ]; then
  echo "miner: no post-synthesis report at $REPORT" >&2
  exit 1
fi

CELL_AREA=$(awk '/Cell Area:/ { print $3; exit }' "$REPORT")
if [ -z "$CELL_AREA" ]; then
  echo "miner: no 'Cell Area:' line in $REPORT" >&2
  exit 1
fi

# Whole number of thousands of square microns.
COUNT=$(awk -v a="$CELL_AREA" 'BEGIN { printf "%d", a / 1000 }')

SLACK=$(awk '/Critical Path Slack:/ { print $4; exit }' "$REPORT")
if [ -z "$SLACK" ]; then
  echo "miner: no 'Critical Path Slack:' line in $REPORT" >&2
  exit 1
fi

mkdir -p "$OUTDIR"

printf '{\n  "count": %s,\n  "slack": %s\n}\n' "$COUNT" "$SLACK" > "$OUT"

cat "$OUT"

```

## The records

```json
{
  "sessions": [
    {
      "id": "run-292b43ce-1eee-4f05-a4f0-e15df944ace3#000007",
      "runId": "run-292b43ce-1eee-4f05-a4f0-e15df944ace3",
      "siteId": "local",
      "seq": 7,
      "at": "2026-09-12T08:05:34.499Z",
      "writer": "executor",
      "generation": 1,
      "type": "session",
      "preset": "hima-moment",
      "sessionId": "session-e2a2ddd8-f6a8-416f-9209-8f9756c909ea",
      "model": "deepseek-v4-flash",
      "nodeId": "mine",
      "attempt": 1,
      "event": "opened",
      "tools": [
        "hima_workshop_write",
        "hima_workshop_read",
        "hima_workshop_knowledge"
      ],
      "workshop": {
        "id": "mine",
        "entry": "miner.sh",
        "entryPath": "/private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-hbDOCy/workspace/workshop-probe-20260912-080531-1327/hima-workshop/mine/miner.sh"
      }
    },
    {
      "id": "run-292b43ce-1eee-4f05-a4f0-e15df944ace3#000009",
      "runId": "run-292b43ce-1eee-4f05-a4f0-e15df944ace3",
      "siteId": "local",
      "seq": 9,
      "at": "2026-09-12T08:05:53.731Z",
      "writer": "executor",
      "generation": 1,
      "type": "session",
      "preset": "hima-moment",
      "sessionId": "session-e2a2ddd8-f6a8-416f-9209-8f9756c909ea",
      "model": "deepseek-v4-flash",
      "nodeId": "mine",
      "attempt": 1,
      "event": "closed",
      "outcome": "completed"
    }
  ],
  "code": [
    {
      "id": "run-292b43ce-1eee-4f05-a4f0-e15df944ace3#000008",
      "runId": "run-292b43ce-1eee-4f05-a4f0-e15df944ace3",
      "siteId": "local",
      "seq": 8,
      "at": "2026-09-12T08:05:51.655Z",
      "writer": "executor",
      "generation": 1,
      "type": "code",
      "nodeId": "mine",
      "attempt": 1,
      "sessionId": "session-e2a2ddd8-f6a8-416f-9209-8f9756c909ea",
      "workshop": "mine",
      "path": "/private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-hbDOCy/workspace/workshop-probe-20260912-080531-1327/hima-workshop/mine/miner.sh",
      "sha256": "ee836557b38282e321984e86f3bbd18c366e13d8b9d2bfe464bc7c50ea927578",
      "bytes": 1611,
      "language": "shell"
    }
  ]
}
```

## The home, read afterwards

- 116 files read under `$DSH_HOME`, the window's user-data directory and the workspace.
- Files that could not be read: [].
- Files holding the key: [].

The key came from the launching environment. HimaHarness writes no credentials file and no env file, reads a key by no path of its own, and no record above carries one.

## Checks

| Claim | Predicate | Saw | |
|---|---|---|---|
| a model moment opened at the workshop node | `an opened session record at node mine` | `["opened@mine","closed@mine"]` | PASS |
| the moment reached exactly the workshop's three tools | `tools === ["hima_workshop_write","hima_workshop_read","hima_workshop_knowledge"]` | `["hima_workshop_write","hima_workshop_read","hima_workshop_knowledge"]` | PASS |
| the moment closed having done what it was opened for | `a closed record with outcome completed` | `["completed"]` | PASS |
| the model wrote the entry inside the workshop directory | `a code record whose path ends hima-workshop/mine/miner.sh` | `["/private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-hbDOCy/workspace/workshop-probe-20260912-080531-1327/hima-workshop/mine/miner.sh"]` | PASS |
| the record hashes the bytes that are really on the site | `sha256 === ee836557b38282e321984e86f3bbd18c366e13d8b9d2bfe464bc7c50ea927578` | `ee836557b38282e321984e86f3bbd18c366e13d8b9d2bfe464bc7c50ea927578` | PASS |
| the fabric ran what the model wrote, within the allowance | `a launched and an ended job named workshop-mine that exited 0` | `["launched","finished:0"]` | PASS |
| the node after it read what the script produced | `an observation holding candidate_count` | `[{"type":"candidate_count","value":10,"unit":"count"},{"type":"candidate_slack","value":-0.1,"unit":"ns","mode":"setup","scope":"reg2reg"}]` | PASS |
| the workshop node is done, within the allowance | `the run's path holds the workshop node in state done` | `["done"]` | PASS |
| the scan read the home rather than nothing | `more than fifty files were read` | `116 files` | PASS |
| the scan read every file it found | `no file under the home was unreadable` | `[]` | PASS |
| the key reached no file the run wrote | `no file under the home holds the key` | `[]` | PASS |
| the harness wrote no env file | `no .env exists under the home` | `[]` | PASS |

