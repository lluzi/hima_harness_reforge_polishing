# Pin accessibility research verification

Date: 2026-09-29. Scope: research artifacts only; no product code, EDA job, target-library assessment or signoff performed.

## Work and review

- Root session owns the contract, industry/recent evidence, synthesis and final report. Root model was not switched during the task; no claim of a lower-cost root model is made.
- One research worker used `gpt-5.6-terra`, `medium`, fresh context, with sole ownership of the academic evidence packet. The same worker then read the complete canonical report as an independent reader and checked technical definitions and attribution. No recursive delegation.
- Review confirmed the signs of RPA/IOC and the distinction between VHP/VHPC against full papers. Corrections applied: label the RPA PDF as a non-author mirror; replace the failing Ye URL with the UT Austin author-lab copy; explicitly define the PAF scenario set; distinguish KAN from CNN/PGNN; update the academic lane's ML access limitation after root retrieved official author slides.
- Appropriate validation is document/source checking. Software tests and EDA runs would not validate these literature claims and were not run. Token/cost attribution not measured.
- Final local Markdown targets resolve; the evidence JSON parses; staged `git diff --check` passes. The source-check record intentionally retains the retired 404 URL as an audit of the correction.

## Automated evidence checks

The [machine-readable record](pin-accessibility-link-check.json) contains 28 unique URL probes, response status, final URL, content type, byte size and body SHA-256 where available. Method: HTTP GET with redirects, 18-second timeout and 20 MB cap. Bodies remain in ignored scratch storage, not in the deliverable.

| Result | Count | Interpretation |
| --- | --- | --- |
| HTTP 200 with body | 18 | Retrieved; content identity and semantic support checked separately for consequential claims |
| HTTP 202 with empty body | 5 | IEEE/DOI automated retrieval did not return usable article content; not counted as full-text access |
| HTTP 403 | 4 | Automated retrieval blocked; browser or alternate primary record used where available |
| HTTP 404 | 1 | Old Ye author URL; replaced in final artifacts with UT Austin C174.pdf, which returned PDF/200 |

Synopsys's 2025 announcement returned 403 to curl but was read in full through Ego browser. Cadence, OpenROAD and the PGNN university record were also read through the browser when web-tool retrieval failed. The research worker read the full Seo paper through the web tool; root's later mirror retrieval failed, so source provenance and the independent KAIST metadata/abstract are retained rather than claiming universal reachability. DOI endpoints remain useful persistent identifiers, not evidence of successful full-text retrieval.

Repeated references to the same paper and the overlapping GF PAC deposits are not independent corroboration. Only arXiv 1805.10012 is used for the PAC numerical comparison.

## Semantic and visual spot checks

- GF SNUG PAC: PDF page 20, Table 3 visually inspected; checked library1 denominator from Table 2 and M2/M3/four-thread conditions in section V. Higher detected problem count is explicitly not routing improvement or measured recall.
- Cell-Flex: official ISPD 2025 PDF pages 8, 9 and 12 rendered and inspected. Verified PAF exponent `1/nPins`, track/via meanings, five-block comparison and the 200-DRV threshold behind the 13.2% headline. Normalized layout metrics are not described as signoff proof.
- ISPD 2020 active learning: full official 28-page slides extracted; page 24 visually inspected for the library-subset transfer/failed-legalization counterexample. No pooled model-accuracy ranking claimed.
- CPCell: read v1 HTML Table IV and section VI-C. Preserved `2/2/3 → 4/7/4`, proxy definition, and submitted-preprint status.
- PAO and Ye: root separately read downloaded author-lab PDFs for AP/pattern/unique-instance definitions and the Pin Access Value formula.
- A Poppler rendering attempt stalled with a fontconfig error on slides; bundled PDFium rendered the selected review pages successfully. No PDF report was authored.

## Argument cards

| Judgment | Mechanism | Concrete case | Rival | Boundary | Decision effect |
| --- | --- | --- | --- | --- | --- |
| Per-pin AP counts do not establish joint accessibility. | Access choices compete through via/metal rules. | Xu VHP/VHPC; PAO compatible patterns | Count thresholds can still screen simple cells cheaply. | Joint models only prove the encoded candidates/rules/context. | Preserve APs and conflicts; add joint analysis selectively. |
| Instance environment matters. | Orientation, track offset, neighboring shapes and PDN change usable access. | PAO signatures; Cadence instance planning; Cell-Flex placement phase | A representative library stress suite may avoid full-chip work. | Synthetic distributions do not equal production placement. | Offer library screening and contextual validation as separate results. |
| Learning should be calibrated against target labels. | Label producer and geometry distribution determine what the model predicts. | ISPD20 Model A to Design B generates excessive spacing and fails legalization | Library-based active learning may reduce dependence on many routed designs. | That case does not show all transfer learning fails. | First use predictions for ranking/active sampling; qualify hard placement rules separately. |

## Reader-value and stopping check

The canonical report explains physical failure mechanisms, compares eight method families, supplies original and explicitly proposed formulas, distinguishes library and design inputs, and gives four next-step options with conditions and failure signals. The independent reader found no blocking technical error. It does not require reading the evidence packets to understand its main argument.

Stop rationale: the method families and consequential counterexamples are sufficiently covered. Further broad search is unlikely to change the next decision. Missing target physical views, rule coverage and router labels are clearly named; no inference of their availability is made. The next experiment belongs to a separately defined implementation/qualification slice.
