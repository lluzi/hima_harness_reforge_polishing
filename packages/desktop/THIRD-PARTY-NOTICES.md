# Third-party notices

`@hima/desktop` depends on neither of the projects below and is a fork of neither. It borrows
patterns from both — read, understood, and rewritten here — and this file is the attribution MIT
asks for in return. The reading itself is `docs/research/2026-09-09-dsh-desktop-shells.md`, which
names every file and line the patterns were taken from and why each one was worth taking.

## dataelement/dsh-desktop

Read at commit `c8c33c423b5e8edd03d69ee0640f42e24fe1f7a5`, licensed MIT.

Borrowed, as patterns and not as code:

- the dsh command line a desktop shell must build — `--no-open`, an explicit loopback `--host`, an
  explicit `--port` — from `src/main/runtime/harness-runtime.ts` L184–200;
- reading the per-process launch token out of the `dsh web:` line, from L160–182, together with the
  reason it has to be read at all: only `GET /?token=…` trades that token for the session cookie;
- the readiness rule that an unauthenticated probe answering 401 means the host is up, and the
  polling shape around it, from L306–320 and L799–826;
- stopping the child with SIGTERM, a bounded wait, and then SIGKILL, from L510–521;
- putting the token on the *first* navigation only, and sweeping stale `dsh-auth-*` cookies off the
  loopback origin before every navigation, from `src/main/window-navigation.ts` L13–73 — with the
  finding that makes it necessary: dsh names that cookie after an authority that includes the port,
  cookies are not port-scoped, and the cookie lasts thirty days, so a fresh port per launch
  accumulates one cookie per launch until the request header is large enough for Node to answer 431.

Nothing else was taken. In particular this shell does not patch any dsh package, does not proxy
`/api/remote.mux` or any other private route, adds no LAN or tunnel surface, and disables no row of
dsh's own plugin tree.

```
MIT License

Copyright (c) 2026 DataElement

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## fendouai/deepseek-harness-desktop

Read at commit `2d1b5051599bd6aafd286f73493521b5d433fed4`, licensed MIT; its `LICENSE` is the upstream
DeepSeek Harness file unchanged, so the copyright line below is the one that file carries.

Borrowed, as a shape and not as code: one window, a local starting document, navigate to the host
once it is ready, and no IPC surface at all for the remotely loaded page. Its own architecture note
states the boundary this shell keeps — all product interaction continues through the existing web
composition.

Not borrowed: it omits `--no-open`, which is the one flag this shell cannot do without.

No name, mark, or icon of DeepSeek Harness or of either project is used here. The window is called
HimaHarness and its icon is drawn by `scripts/make-icon.mjs` in this package.

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
