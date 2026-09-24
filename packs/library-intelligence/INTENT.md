# Library Intelligence qualification (development)

This development Pack holds the E1 method and a Pack-local manual probe for one declared QuaLib runtime against exactly three bounded inputs: a vendor fixture, one SAED14 representative, and one TSMC28 representative. Its default graph enters a hard wait and declares no tool that can launch the native API. E1 product qualification is incomplete. The Pack does not scan a corpus, produce Library facts or a design-impact report, or authorize a Library edit.

For a bounded manual probe, the Site owner provides the input manifest and a Permit snapshot in an isolated workspace. The manual worker reads, queries, copies only within that workspace, re-reads, compares, and re-hashes each source. Until Host integration attests that the snapshot is the Permit it loaded and enforces the license exclusion before launch, a Pack-local receipt is development evidence, not an admitted product qualification.
