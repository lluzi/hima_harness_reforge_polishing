// @hima-seam skills direct
// Ticket #64: the pack authoring pipeline's last three stages — fabric compiles the spec, test runs
// the compiled pack and writes the record from what the Run recorded, release seals the folder with
// hashes the harness computed.
//
// **The seam.** These run through `bootInProcess` + `sayAsUser`, as `skills.test.ts` does and for the
// same reason: a stage is a *person's own message* to the root agent, and the one composer a person
// types into is the web app's, which the driver has no control for (ADR-0004 marks Hima's own
// controls and nothing else). So what a person's message does to a session is asked of the host, and
// the one place any test makes such a message is `sayAsUser`. One session per boot, because replay's
// cursor does not go back to the start.
//
// The window is still the seam for the one thing that *is* a person clicking: the start form's marks
// and the Run a click of it starts. That half boots the shell in driver mode on the very home the
// stages authored in.
//
// **What each test is about.**
//
// *Fabric compiles, and refuses a contradiction.* From a folder the committed grill and spec
// transcripts left at `specified`, the fabric stage reads every source its body names an authority
// for a shape — the spec, the record it points back at, the Golden Flow, the six knowledge files,
// the skeleton of every file kind a pack folder holds, and the pack installed beside this one —
// writes the pack's own files, puts the script it wrote to the author, and records their verdict in
// their words. Nothing the spec asked for is missing, so the gap list says `none`. A spec whose judge
// rule reads a value its own Semantics does not declare is refused naming the section and quoting the
// line, and nothing at all is written.
//
// *Test writes the record, and the record is evidence.* The stage starts a Campaign marked a test
// run, reads the Run back and writes `TEST.md` from it. The run row carries the digest of the folder
// it ran, so editing a script afterwards puts the folder back at `compiled` until the stage runs
// again — which is what "re-entering a stage after a change retests" means.
//
// *Release seals, and a change is refused.* `VERSION.yml` covers every file with the hash this
// harness computed; editing one, or adding one, makes the check name that file and makes a Campaign
// refuse the pack before anything is sent to a Site.
//
// Nothing here needs an API key and nothing here may have one.

