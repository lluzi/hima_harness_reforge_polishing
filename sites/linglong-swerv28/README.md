# linglong-swerv28 XTop Operator administration

`xtop-operator-v1.sh` is the Site-owned production wrapper. Install those exact bytes at
`/data/eda/project/hima_harness/operator-admin/xtop-v1/xtop-operator-v1.sh`, outside the Permit write
root, mode `0755`. It pins the container image, read-only root and `/data/eda` mount, dropped
capabilities, `no-new-privileges`, host networking needed for the localhost licence service, and one
derived Campaign workspace as the only writable bind.

The earlier qualification wrapper SHA `67d6055692d03cd19e462c0ab7b69dead1128bdf7629637535c01b53f07e4277`
was scoped to `operator-qualification-20260924/private`; it is retained evidence, not this production
wrapper and must not be installed as the production binding.

After deploying the production wrapper, rerun the bounded real XTop qualification under a fresh child
of `/data/eda/project/hima_harness/xtop-timing-closure-runs`. Copy
`xtop-operator-environment.template.json` to an administrator-owned local path outside all Campaign
workspaces, fill the current Pack/adapter/command identities, replace the fresh production transcript
and two ECO hash placeholders, and set `status` to `passed`. Do not reuse hashes from the
qualification-only root. The generator refuses evidence qualified against a different Pack digest or
typed command classification.

Build HimaHarness, then generate the exact Host binding. The generator computes the current retained
Pack digest and command classification; neither is hard-coded into the Pack:

```sh
node scripts/generate-xtop-operator-binding.mjs \
  --environment /absolute/admin/xtop-operator-environment.json \
  --output /absolute/admin/interactive-bindings.json
```

Configure `interactiveBindingsFile` to the generated absolute output path. The generator refuses any
Site/tool other than `linglong-swerv28` / `run-xtop-fix`, invalid or incomplete qualification evidence,
an environment file inside the production write root, or an existing output. At each open and dispatch
the Host re-reads the binding/evidence, retained Pack and remote wrapper. A changed byte, symlinked
wrapper, Permit/root mismatch, Pack digest change or command change revokes confinement; a JSON hash
without this strict evidence remains unqualified.
