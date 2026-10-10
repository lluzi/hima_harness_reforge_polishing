# Cell requirements file (hima-andes-requirements/1)

One JSON object, delivered as the result of your task. `k` is `timingState.round`.

```json
{
  "schema": "hima-andes-requirements/1",
  "agent": "himatime",
  "round": 1,
  "summary": "The S-box/MixColumns paths set Fmax: XNOR3 and BUF stages carry 44 % of the worst path.",
  "requirements": [
    {
      "family": "XNOR3",
      "purpose": "Faster rising output for the S-box XNOR3 trees",
      "target": "cell delay -30 % at fanout 4",
      "evidence": "A1-A7 S-box paths; XNOR3 268 ps of 1044 ps on A1; HimaTime est. recovery 3.04 ns",
      "priority": 1
    },
    {
      "family": "BUF",
      "purpose": "Mid-drive balanced buffer for the fanout-6..12 S-box nets",
      "target": "cell delay -25 % at fanout 6",
      "evidence": "BUF on all 20 worst paths, 18.8 % of A1; est. recovery 2.09 ns",
      "priority": 2
    }
  ],
  "report": "requirements/himatime/r1/analysis.md"
}
```

- `agent`: `himatime` or `qualib` (your role). `round`: k.
- `requirements`: 1-8 items (2-5 recommended). `family`: an AndesCell family (`andescell
  families`; `XNOR2` means `XOR2`). `target`: text with a percentage. `evidence`: text or an object
  naming paths, stages, report numbers. `priority`: 1-5 (1 highest) or high/medium/low.
- `report`: `requirements/<agent>/r<k>/analysis.md`, written in your private workspace at that
  relative path and delivered as support. Support paths are immutable: a repair in the same round
  writes the same path only if it is unchanged, otherwise a new name (e.g. `analysis-2.md`).

## Precheck and delivery

```
python3 <campaign>/flow/andes_cli.py precheck <campaign> <agent> <your requirements file>
```

It runs the same check as the Pack's Reader and prints every problem, or `precheck PASS`. Deliver
the requirements file as the one `result` artifact and `analysis.md` as `support`. A refused
delivery comes back with the problems; repair it in the same task.
