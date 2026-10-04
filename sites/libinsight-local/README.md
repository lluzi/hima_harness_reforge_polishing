# libinsight-local

A `local` demo Site for the `libinsight-offline-demo` Pack. It runs the offline LibInsight analysis
on this machine with `/usr/bin/python3` only; it holds no licence seat.

## Before you load it

`site.yml` and `permit.yml` carry a `__DSH_HOME__` placeholder for the Campaign workspace root. The
demo kit copies these two files into `<DSH_HOME>/hima/sites/` and rewrites `__DSH_HOME__` to the
absolute harness home, so the workspace root and the permitted read/write roots are real absolute
directories. To do it by hand:

```
DSH_HOME=/absolute/path/to/your/hima-home
mkdir -p "$DSH_HOME/hima/sites/libinsight-local/workspace"
sed "s#__DSH_HOME__#$DSH_HOME#g" site.yml   > "$DSH_HOME/hima/sites/libinsight-local.yml"
sed "s#__DSH_HOME__#$DSH_HOME#g" permit.yml > "$DSH_HOME/hima/sites/libinsight-local.permit.yml"
```

(When installed under `hima/sites/` the site file is named `libinsight-local.yml` and its permit
`libinsight-local.permit.yml`, matching the `permit: ./permit.yml` reference once renamed.)

## Bindings

- `libInsightRoot` -> `/Users/lluzi/code/lib_insight` (read-only; holds `kits/<kit>.json` and
  `data/store`). Change it only if your lib_insight checkout is elsewhere.
- `workspaceRoot` -> the Campaign's private workspace under this Site (also the only write root).

## Permit

`/usr/bin/python3` is the only wrapper. Read roots are the workspace and the read-only lib_insight
checkout; the only write root is the workspace. Nothing is ever written into the lib_insight
checkout.
