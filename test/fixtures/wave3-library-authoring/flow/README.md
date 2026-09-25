# Local Library authoring-qualification Golden Flow

Run one local generation with:

```text
sh analyze-library-contract.sh library-input.json library-insight.json
python3 read-library-contract.py library-insight.json observation.json
```

`analyze-library-contract.sh` checks the five fields specified in the source
requirements and writes a small JSON result. `read-library-contract.py` emits
one `library_contract_ready` value in `count`: `1` only when that result is
present and valid. Missing or malformed input exits non-zero and emits no
successful numeric value.

This Golden Flow is deliberately local and non-commercial. It does not use
Liberty, QuaLib, `edarun`, a Site EDA wrapper or production data.
