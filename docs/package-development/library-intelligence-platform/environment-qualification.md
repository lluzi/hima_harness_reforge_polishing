# Empyrean Liberty API environment qualification

> Historical snapshot from 2026-09-22. The bounded QuaLib 2026 vendor/SAED14/TSMC28
> qualification passed on 2026-09-24; see the [new receipt](qualification/2026-09-24-qualib-2026.md).
> The original exit 139 evidence below is preserved, not a statement of the current API state.

Date: 2026-09-22

Site: `linglong`

Status: **environment installed; parser qualification failed; no diagnosis attempted**

## Change boundary

Created:

- Miniconda: `/data/eda/runtime/miniconda3`
- isolated environment: `/data/eda/venvs/qualib-libapi-2026-py37`

Unchanged:

- system Python;
- `/usr/local/bin/edarun` and its AlmaLinux 8 image;
- `/data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94`;
- the active Empyrean 2025 license service and QuaLib installation;
- QuaLib 2026 service activation.

The Miniconda installer came from the
[official repository](https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh). Its SHA-256 was checked
before installation:

```text
e8b25b92b262499141c5bd57a98d3c008024185fa951494b9cd9b6d94e72338b
```

Installed runtime:

```text
conda 26.7.1
Python 3.7.12
```

The environment was created from `conda-forge` with `python=3.7` and `pip`. Relevant package
identities at qualification time were:

```text
icu         78.3
libgcc      16.2.0
libstdcxx   16.2.0
openssl     3.6.4
pip         24.0
python      3.7.12
setuptools  69.0.3
sqlite      3.53.4
```

## Input identity

```text
46bb7b0cdf045a1623dc7c685854bf69f641982e11297e04d887f84b1403a4c1  API/README
b62dcc2729ddb3ca26447a94ec47b47bfa3774234e9b7b7bc1ffd6a114a7e86b  API/demo/testParser.py
0f72cff56a3ccb7e1bfeff4234c44bb85c42524d31eed18df7a59c40b4f47877  API/demo/testParser.lib
11b9eec8af31f9c19cd52999e7caffc4899c73a878fcd6b7c8e75831eaa24f56  API/_tmlib.so
4918f49c4921c6b43f1dca1e8e5428f3476e1b631cfebae3b1e3feeea09031d5  API/lib/libparser_wrapper.so
f44e090f34d65e4cce10fc545f4b00c65959a92333a6d1e2f8e1b8c3ec6dde45  qualib-libapi-2026-py37/bin/python
```

All demo files were copied to a temporary directory before execution, so parser logs and
`output.lib` could not modify the installed vendor payload.

## Qualification command shape

The vendor-declared Python and native-library variables were applied inside `edarun`. The license
variable was explicitly removed because the installed README states API module import does not require the
Empyrean FlexNet daemon:

```text
timeout 30 /usr/local/bin/edarun \
  env -u EMPYREAN_LICENSE_FILE \
  LIBERTY_API_HOME=<API> PYTHONPATH=<API> LD_LIBRARY_PATH=<API>/lib \
  <PYTHON_3_7> -X faulthandler testParser.py
```

Observed result:

```text
Fatal Python error: Segmentation fault
Current thread ...:
  File ".../API/tmlib.py", line 1202 in name
  File "testParser.py", line 5 in <module>
parser_rc=139
```

The failure occurs after import and `readTmlib`, on the first `lib.name()` call. This is only a
reproduction boundary; no root cause is claimed. The user explicitly directed this turn not to debug the
API, so no library substitution, preload, ABI probe, vendor binary modification, or Python-version matrix
was attempted.

## Product gate

The environment is available but the API is not qualified for product use. A HimaPack must not report
successful Library analysis from this runtime until the same fixture and at least one representative real
Library complete read/query/write-copy/round-trip checks. The blocked implementation specification is
[LIB-INT-01](first-slice-spec.md).

## Rollback

No rollback was performed. If the owner later requests removal, the only new server paths are the two
directories listed under Change boundary. Removing them would not restore or alter any service because no
service or system interpreter was changed.
