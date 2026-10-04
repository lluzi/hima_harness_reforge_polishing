# Third-party distribution notices and qualification

This document records U9's actual dependency audit and the material a candidate must retain. It does
not grant commercial release clearance. DBOS is not the complete dependency set.

## Scope and evidence

An audit-only production deployment was made with the existing `pnpm --filter @hima/desktop --prod
deploy --legacy` command, filtering the Electron npm wrapper as the real packager does. It contains
552 npm package roots on this macOS arm64 host. It is not a release App or source-frozen installation
qualification. Exact package/version, source integrity, package.json/license hashes, native object
paths and links are retained in `.hima-tmp/dbos-migration/u9/packaging/audit-deploy/third-party/SBOM.json`.
The packager regenerates that inventory from each actual native candidate, never copies this audit
result as Linux evidence. The file hash for the audit with retained supplemental materials is `b06641a8ba7377f84220d38a36d79e0c5782fc55b592239cde4ed03c30f0402d`.

Declared npm licenses include MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Python-2.0,
Unlicense, `(MIT OR CC0-1.0)` and **LGPL-3.0-or-later**; the Hima workspace package is undeclared
proprietary/project material, not an inferred open-source grant. License strings alone do not discharge
notice, embedded-library or source obligations.

## Material retained in every candidate

- Node: exact official archive URL/hash and Node binary; `third-party/NODE-LICENSE` is the full upstream
  aggregate copyright/license text, including Node's bundled libraries. That aggregate is retained
  rather than incorrectly describing all embedded libraries as Node's MIT license.
- Electron44.2.0: exact target archive URL/hash, native executable/framework/ffmpeg bindings,
  `third-party/ELECTRON-LICENSE` and `third-party/CHROMIUM-LICENSES.html`. Chromium and codec/library
  notices must accompany Electron; Electron's MIT grant does not replace them. Patent/codec coverage
  is not established by this dependency audit.
- PostgreSQL16.15: official source SHA256
  `c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed`, `postgres/COPYRIGHT`,
  configure flags, relocated bin/lib/share hashes and actual dynamic links in `postgres-runtime.json`.
  The official copyright permits use and distribution with its notice and disclaimer retained.
- Each npm component: retain the exact package's LICENSE/COPYING/COPYRIGHT/NOTICE files. The generated
  `third-party/SBOM.json` and `third-party/THIRD_PARTY_NOTICES.md` identify them. MIT/ISC/BSD attribution
  and disclaimers must remain; BSD no-endorsement terms apply where present. Apache2 redistributions
  retain its license and applicable upstream notices; modifications require the relevant change
  notices, and trademark grants are not implied. See the [Apache2 license](https://www.apache.org/licenses/LICENSE-2.0).

## Actual native links and embedded components

The macOS production-dependency audit successfully inspected 9 target native objects. It also
inventoried 10 foreign upstream prebuilds separately, without claiming their links were audited.
Target modules include the DeepSeek system addon, require-builtin addon, node-pty/spawn-helper,
Ripgrep, Koffi, extract-zip, Sharp and libvips. Koffi/Sharp/node-pty link macOS libc++/libSystem;
Sharp loads `@rpath/libvips-cpp.8.18.6.dylib`. libvips additionally links macOS Foundation, CoreFoundation,
AppKit, CoreGraphics, CoreServices, CoreText, libiconv, libresolv and libobjc. The extract-zip universal
module's `/Users/runner/...` entries are its own Mach-O install IDs (`otool -D`), not unresolved
external libraries; its external links are libiconv/libSystem. All original inspection lines and own
IDs are retained. The pinned macOS PostgreSQL distribution links its bundled relocated libpq and
macOS libSystem; configured Readline/ICU/zlib are absent from that PG link inventory. This does not
mean Node, Electron, Sharp or the whole App omit those libraries.

`@img/sharp-libvips-darwin-arm64@1.3.3` declares LGPL-3.0-or-later and supplies a combined libvips8.18.6
binary with these upstream-declared embedded versions (`versions.json`, not independently reconstructed
from binary symbols):

aom 3.15.0; archive 3.8.9; cairo 1.18.4; cgif 0.5.3; exif 0.6.26; expat 2.8.3; ffi 3.8.0; fontconfig 2.18.3; freetype 2.14.3; fribidi 1.0.16; glib 2.89.4; harfbuzz 14.3.1; heif 1.23.2; highway 1.4.0; imagequant 2.4.1; lcms 2.19.1; mozjpeg 0826579; pango 1.58.2; pixman 0.46.4; png 1.6.58; proxy-libintl 0.5; rsvg 2.62.91; tiff 4.7.2; uhdr 2.0.2; vips 8.18.6; webp 1.6.0; xml2 2.15.3; zlib-ng 2.3.3.

The exact native package lacks standalone license/copyright files. Commercial delivery is unresolved
until its LGPL/GPL notices and component attribution, corresponding-source/build material, and a
supported library-replacement or relinking route are established for these exact native bytes.
LGPL3 permits combined applications under chosen terms subject to its conditions, including notices,
GPL/LGPL copies and the applicable replacement/relinking requirements; no claim that LGPL forces
this entire App to become GPL is made. See [LGPL3 text and combined-work conditions](https://spdx.org/licenses/LGPL-3.0-or-later.html).
Node/Electron aggregate disclosures and Sharp's versions file are not a fully resolved component-level
SBOM for all statically embedded code.

## Retained notices and remaining distribution conditions

A focused content review found full MIT copyright/grant/disclaimer texts in the shipped READMEs of
pg-types2.2.0, pgpass1.0.5 and data-uri-to-buffer4.0.1. Absence of a standalone LICENSE is not absence
of a notice. The packager explicitly inventories those full README notices. It also accepts exact
package-source-bound supplemental notice files, copies them into `third-party/upstream`, and hashes
them; a changed notice or foreign npm integrity is refused.

Exact npm registry source gitHeads were used to fetch the DBOS datasource, pi-ai/pi-telemetry, xterm,
standardwebhooks and sharp-libvips notices/build material into
`.hima-tmp/dbos-migration/u9/packaging/upstream-notices/notice-materials.json`. The libvips build repository
LICENSE is Apache2 for its build scripts, not the LGPL native grant. Its exact-commit THIRD-PARTY-NOTICES
and versions.properties, canonical LGPL/GPL texts and build scripts are separate retained materials.
Shipped README disclosures and upstream license tables must be reviewed with these exact versions.
None of those notices substitutes for native corresponding source or working library replacement.

The audit with these source-bound materials records these remaining findings:

- @aws-sdk/credential-provider-http@3.972.72 at node_modules/.pnpm/@aws-sdk+credential-provider-http@3.972.72/node_modules/@aws-sdk/credential-provider-http: no standalone license/notice file; inspect upstream distribution terms
- @aws-sdk/credential-provider-login@3.972.77 at node_modules/.pnpm/@aws-sdk+credential-provider-login@3.972.77/node_modules/@aws-sdk/credential-provider-login: no standalone license/notice file; inspect upstream distribution terms
- @aws-sdk/nested-clients@3.997.44 at node_modules/.pnpm/@aws-sdk+nested-clients@3.997.44/node_modules/@aws-sdk/nested-clients: no standalone license/notice file; inspect upstream distribution terms
- @electron-internal/extract-zip@1.0.5 at node_modules/.pnpm/@electron-internal+extract-zip@1.0.5/node_modules/@electron-internal/extract-zip: no standalone license/notice file; inspect upstream distribution terms
- @img/sharp-libvips-darwin-arm64@1.3.3 at node_modules/.pnpm/@img+sharp-libvips-darwin-arm64@1.3.3/node_modules/@img/sharp-libvips-darwin-arm64/lib: LGPL native binary and embedded libraries require exact upstream license/copyright disclosures, corresponding-source/build material, and verified library replacement or relinking terms before commercial distribution
- @koromix/koffi-darwin-arm64@3.2.1 at node_modules/.pnpm/@koromix+koffi-darwin-arm64@3.2.1/node_modules/@koromix/koffi-darwin-arm64: no standalone license/notice file; inspect upstream distribution terms

The scoped license reviewer owns closure of the actual notices, the LGPL-elected libvips components
and Electron/ffmpeg obligations. LGPL permits commercial use subject to its conditions; the current
findings do not establish an inherent incompatibility with a proprietary App. The snapshot is not
commercial acceptance. Linux needs its own actual deployment and native-link inventory. New
nonadministrator-account installation, directory relocation, exit/reopen, native hardware, OS baseline
and workflow-vendor network isolation are separate qualifications. No zero-legal-risk or complete
whole-system SBOM claim is made.
