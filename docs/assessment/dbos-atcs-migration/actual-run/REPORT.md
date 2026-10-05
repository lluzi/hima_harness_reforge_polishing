# ATCS engineering delivery

Goal met: false

Stop reason: Protected setup AutoFix passes and further manual sizing produced no change beyond setup 18 / -0.0237 / -0.0973 while hold is 0 / 0 / 0 in every required scenario; available XTop mechanisms plateaued and the best measured state was retained.

Timing (raw verified Reader values):

```json
{
  "hold": {
    "tnsNs": {
      "value": 0
    },
    "violations": {
      "value": 0
    },
    "wnsNs": {
      "value": 0
    }
  },
  "setup": {
    "tnsNs": {
      "value": -0.0973
    },
    "violations": {
      "value": 18
    },
    "wnsNs": {
      "value": -0.0237
    }
  }
}
```

Collateral / regression / UNKNOWN:

```json
{
  "regression": {
    "unknown": "required collateral comparison unknown: capacitance, fanout, legality, transition"
  },
  "remaining": {
    "value": 18
  },
  "unknown": {
    "value": 4
  }
}
```

Engineering artifacts: engineering-artifacts.tar.gz

Native timing evidence is prediction-only; physical adoption/signoff is not claimed.
