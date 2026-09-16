# FW-T2 Yosys/ABC mapping smoke

Date: 2026-09-15

Scope: real, license-free mapping only; this is evidence for the mapping part of
FW-T2, not the complete FW-T2 or Framework assessment.

## Environment and provenance

The run used an isolated local tool tree on arm64 macOS 26.5.2. Homebrew could
read formula metadata but could not take its lock under `/opt/homebrew`, so the
published arm64 Tahoe bottles were downloaded directly from the Homebrew GHCR
registry, checked against formula metadata, and extracted under `.hima-tmp`.
No Homebrew prefix, Docker daemon, Site, remote host, or product installation
was changed.

| Artifact | Source SHA-256 |
| --- | --- |
| `yosys-0.69.arm64_tahoe.bottle.tar.gz` | `03e41ff8da0969905351eb9d4c08d47072ec9465e4388703fe01e2b15d0f93b6` |
| `tcl-tk-9.0.4.arm64_tahoe.bottle.tar.gz` | `5f827b236bad97d36743a3abfa75f746f998ccf4d6cf46e55b4ad167cccf14d6` |
| `libtommath-1.3.0.arm64_tahoe.bottle.tar.gz` | `fe707123e6ec8488bae4013ce49404a63b00dc6c1c11b12202e25f53a62ef586` |
| `readline-8.3.6.arm64_tahoe.bottle.tar.gz` | `15cdd69af824537192843db389cbfd2459b3797cf4f36c906f8f8ab617d7d59f` |

The Mach-O load commands were relocated only in the extracted copies and the
copies were ad-hoc signed. Their execution identities were:

| Tool | Reported identity | Relocated executable SHA-256 |
| --- | --- | --- |
| Yosys | `0.69+post`, git `143eb14f9cc55d6f8927e68523b0c9d2166ed02c`, Release, AppleClang 21.0.0 | `133b83a5a43a1ab350a891970447c0f6b83535fa4276a2115c1670375dd47ec4` |
| ABC | `UC Berkeley, ABC 1.01`, compiled 2026-09-09 | `3eef85baf428494c3a3ea926c01f4cf898b1bdcd6a0215752b0fbb9d462dda44` |

The retained local-only evidence is under:

```text
/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/lfr-tools/
  provenance.json
  fw-t2-adapter-5/
    request.json
    result.json
    output/{reference,augmented}/
```

These files and all binaries remain ignored temporary data and are not Pack or
repository artifacts.

## Real paired mapping result

The smoke input was a four-input combinational cone. The reference Library had
basic buffer, inverter, NAND and NOR functions. The augmented Library added an
`AOI22_X1` function. Both arms used the same RTL, top, constraints, mapping
profile and command plan; only the Library and output paths differed.

| Check | Observed result |
| --- | --- |
| Reference return code | `0` |
| Augmented return code | `0` |
| Reference Cell census | `INV_X1: 4`, `NOR2_X1: 3` |
| Augmented Cell census | `AOI22_X1: 1` |
| Reference/augmented normalized plan | equal, SHA-256 `b6625f1cc9c88657e171cc73ada2d2a592328117e0b6d67e1c2001c673631d62` |
| Request file SHA-256 | `3c481247721f7a3de85ab9dbdd867a6f71fbb81e68d6b9e1c40aae9070bb159e` |
| Result file SHA-256 | `550292473e402ad7a938340f09ae96c7e58dd44b5c70956fbbd47729d2f4ca50` |
| Reference mapped netlist SHA-256 | `c9576e6956ab8cbb104aebb95d96158f4c02c924abbf610ceec5b2925103c970` |
| Augmented mapped netlist SHA-256 | `c3924ad1135ca6eb056ea9e6678be02b6cb36ec46da62dbe30592a7e6cdbeecf` |

This proves that the local Yosys/ABC pair can perform real reference and
augmented technology mapping and that the adapter's census and plan audit can
consume the resulting netlists.

## Findings that must remain visible

The adapter initially emitted `{path}` for Yosys arguments. Yosys 0.69 treated
the braces as literal filename characters, so the first `read_liberty` failed.
The adapter was corrected to emit escaped double-quoted paths and to preflight
both Libraries for a one-input non-inverting buffer. The result above came from
calling the repository CLI directly, without a copied adapter or runtime
override:

```text
/usr/bin/python3 packs/custom-cell-fmax-dtco/flow/domain/proxy_mapping.py \
  --request .hima-tmp/lfr-tools/fw-t2-adapter-5/request.json \
  --output .hima-tmp/lfr-tools/fw-t2-adapter-5/result.json
```

A deliberately incomplete Liberty without a detectable buffer reached ABC in
the diagnostic copy, and ABC exited with signal-derived return code `139` after
warning that it could not detect a buffer. Adding `BUF_X1` made the same mapping
sequence succeed. The repository adapter now rejects a mapping Library without
a one-input non-inverting buffer before tool execution. Other tool failures
still remain structured evidence; this smoke does not justify assuming that
every return code 139 has the same cause.

## Limits

- The Liberty is a small functional smoke fixture, not foundry timing data.
- This run does not exercise proxy STA, NLDM interpolation, sequential mapping,
  multi-clock handling, shard reuse, a Hima Job/Permit path, or recovery.
- It does not establish DC/Innovus correlation, route adoption, Fmax benefit,
  cross-design generality, or Phase 1 exit.
- The extracted local tool tree is evidence infrastructure. Product delivery
  still needs a declared compatible tool identity and normal HimaPack/Site
  execution in Phase 2.
