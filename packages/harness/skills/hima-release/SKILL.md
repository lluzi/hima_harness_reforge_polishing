# hima-release

You make a tested pack a version somebody can install: the files it is made of, their hashes, and the
test record it rests on, sealed in `VERSION.yml`.

**You write nothing by hand.** A version file you typed would carry hashes nothing computed, and the
whole point of a release is that a person can check its hashes against the bytes in the folder. The
harness computes them; you ask it to, and you report what it sealed.

## What you do

1. **Call `hima_pack_check`** with this pack and the Site the author named, or — if they named none —
   any Site this pack is checked against, because the ladder's answer does not depend on which. If
   the folder stands below `tested`, refuse in words: say which rung it is on, what the next one
   needs and which stage writes it, and stop. Name what is missing plainly. A folder that was tested
   and has been edited since stands below `tested` again, and the answer says so — the fix is to run
   `/hima-test` again, not to release.
2. **Call `hima_pack_release`** with this pack. It seals the folder, or refuses and says why.
3. **Report what was sealed**: the pack and the version its contract declares, how many files the
   seal covers, the run its test record rests on, and where the seal was written. Say whether this
   replaced a seal the folder already carried. Distinguish this method-integrity seal from the
   test Run's maturity: installable bytes mean the seal/check agree; they do not claim a new Site,
   report shape or business result has been qualified.

That is the whole stage.

## What the seal says, so you can explain it

`VERSION.yml` holds the pack id, the version the contract declares, when the release was written, the
test record and the run it names, and one line per file of the folder with that file's sha256. Every
regular file is in it — the pipeline's own records included — because a person installing this pack
is entitled to know that the intent, the spec, the fabric record and the test record they are reading
are the ones it was released with.

From then on `/hima pack check` holds the folder against that file, and a Campaign refuses a pack
whose files no longer match it, naming the file. That is what a release is for: a pack a campaign
names cannot have changed under it.

Two things worth saying to the author when they come up:

- **The version is the contract's.** A pack declares its version once, and the release seals whatever
  the contract says. Releasing again over the same version rewrites the seal, which is exactly what
  follows a corrected script and a re-run test stage; changing the version is an edit to
  `contract.yml`, and that is the author's to make.
- **The seal covers the folder as it stands now, and not every edit to a record is allowed.** A
  record file is not part of what a campaign runs, so editing one moves no hash the digest is taken
  over — but four things in `TEST.md` are held against the ledger before anything is sealed, and an
  edit to any of them is a refusal rather than a reseal:
  - the **run line** — `Run` holds exactly one `run: <run id>`, and that run must be in this ledger,
    have run this pack, be marked a test run, have ended, and have run the files this folder holds
    now;
  - the **status line** — `Ending` holds exactly one `status: <what that run ended as>`; two lines,
    or one naming another ending, is refused naming the section;
  - the **code hashes** — `Code` carries a line per code record that run wrote, each with that
    record's sha256, or says exactly `none` when it wrote none; and
  - the **refusal ids** — `Refusals` carries a line per refusal record, each with that record's id,
    or says exactly `none`.

  Everything else in the five records is the author's own words and is sealed as it stands: the
  `Site` and `Disagreements` sections, the prose under the status line, every generation line, and
  the whole of `INTENT.md`, `SPEC.md` and `FABRIC.md`. The seal carries the hash of what is there at
  this moment, so a person installing the pack reads the records it was released with — and a person
  who rewrote what the four above say is told which, and sent back to `/hima-test`.

## Rules that do not bend

- **Nothing written by hand.** No hash, no file list, no version file. The verb writes it.
- **No repair.** A refusal names what is wrong with the folder; the fix is the stage that owns that
  file, not this one. Tell the author which stage to run.
- **This folder only.** Nothing outside the session's working directory is read for the seal or
  written by it.
- **Resume from the check.** On a reopened or changed folder, `hima_pack_check` names the first
  current rung and its actual method/test mismatch. Run that owner stage and obtain its new digest
  before asking `hima_pack_release`; a prior seal, review or remembered version is never a repair.
