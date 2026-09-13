# AES pilot Site

`site.yml` records the isolated Linglong binding used by the validated probe. Its `flowRoot`
contains the Pack's `flow/` source plus Site-private `inputs.json`; writes go only to the separate
polishing Campaign root. The original Design Zoo, libraries and previous Campaigns remain inputs.

For another Site, CAD stages the Pack's `flow/` directory, creates `inputs.json` with `design`,
`rtlGlob`, `foundryDb`, `edaWrapper` as described in that directory's README, then adjusts this
Site's paths, SSH destination, capacity and Permit. No credential or foundry library belongs in
Pack method files. Copy this Site into the installed home's `hima/sites/` as a chosen name and
keep its Permit path resolvable. The existing native Pack check reports contract/Permit gaps;
actual file/tool/licence readiness requires Site preflight and the bounded test Run.

The template grants one concurrent Job and one Design Compiler seat. The probe tool itself
requests eight cores and a 600-second tool deadline. These are pilot limits, not measured host
hardware specifications or OS-enforced memory isolation. `/usr/bin/python3` is the explicitly
permitted Pack tool/reader wrapper; `/usr/local/bin/eda` is the Site's EDA launcher.
