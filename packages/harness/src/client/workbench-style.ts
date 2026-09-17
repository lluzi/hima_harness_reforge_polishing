// Hima's native dock presentation. One token sheet, one 12 px floor, one selector scope
// (`.hima-root`) so the tokens work inside any dsh slot without touching `:root`.
// Later tasks add class rules for the Campaign canvas and its cards through these same tokens;
// this file only carries the tokens and the chrome that survives every later task unchanged.
export const HIMA_STYLE = `
/* HIMA CLIENT TOKENS BEGIN */
.hima-root{
  color-scheme:light dark;
  --hima-font-ui:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Helvetica Neue",Helvetica,Arial,sans-serif;
  --hima-font-mono:"SF Mono","JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --hima-fs-display:20px; --hima-fs-title:16px; --hima-fs-body:14px; --hima-fs-label:13px; --hima-fs-eyebrow:12px;
  --hima-lh-tight:1.25; --hima-lh-body:1.5; --hima-track:.06em;
  --hima-sp-1:4px; --hima-sp-2:8px; --hima-sp-3:12px; --hima-sp-4:16px; --hima-sp-5:20px; --hima-sp-6:24px; --hima-sp-8:32px;
  --hima-r-s:4px; --hima-r-m:8px; --hima-r-l:12px;
  --hima-paper:var(--dsw-alias-background-primary,#fbfaf7);
  --hima-soft:var(--dsw-alias-fill-secondary,#f3f1ec);
  --hima-glass:#17161a; --hima-glass-ink:#d9d4c8; --hima-glass-line:#ffffff1f;
  --hima-line:var(--dsw-alias-border-l2,#e3dfd6); --hima-line-strong:#00000029;
  --hima-ink:var(--dsw-alias-label-primary,#232120); --hima-ink-2:var(--dsw-alias-label-secondary,#615c55); --hima-ink-3:var(--dsw-alias-label-tertiary,#8a847b);
  --hima-on-solid:#ffffff;
  --hima-good:var(--dsw-alias-state-success-primary,#2f7a45); --hima-live:#b8532f; --hima-warn:var(--dsw-alias-state-warn-primary,#8e620d);
  --hima-bad:var(--dsw-alias-state-error-primary,#ad3f36); --hima-accent:#4f5fd8; --hima-neutral:#8a847b;
  --hima-shadow:0 1px 2px rgba(20,18,15,.06),0 10px 28px rgba(20,18,15,.08);
  color:var(--hima-ink);font-family:var(--hima-font-ui);font-size:var(--hima-fs-body);line-height:var(--hima-lh-body);font-variant-numeric:tabular-nums;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .hima-root{
  --hima-paper:var(--dsw-alias-background-primary,#1c1b1c);--hima-soft:var(--dsw-alias-fill-secondary,#252422);
  --hima-line:var(--dsw-alias-border-l2,#3a3733);--hima-line-strong:#ffffff29;
  --hima-ink:var(--dsw-alias-label-primary,#ece8e0);--hima-ink-2:var(--dsw-alias-label-secondary,#b5afa4);--hima-ink-3:var(--dsw-alias-label-tertiary,#8f8a80);
  --hima-on-solid:#1c1b1c;
  --hima-good:var(--dsw-alias-state-success-primary,#8fcb9c);--hima-live:#e59a7a;--hima-warn:var(--dsw-alias-state-warn-primary,#dcb45f);
  --hima-bad:var(--dsw-alias-state-error-primary,#e38f87);--hima-accent:#a3abff;--hima-neutral:#8f8a80;
  --hima-shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.35);
}}
:root[data-theme="dark"] .hima-root{
  --hima-paper:var(--dsw-alias-background-primary,#1c1b1c);--hima-soft:var(--dsw-alias-fill-secondary,#252422);
  --hima-line:var(--dsw-alias-border-l2,#3a3733);--hima-line-strong:#ffffff29;
  --hima-ink:var(--dsw-alias-label-primary,#ece8e0);--hima-ink-2:var(--dsw-alias-label-secondary,#b5afa4);--hima-ink-3:var(--dsw-alias-label-tertiary,#8f8a80);
  --hima-on-solid:#1c1b1c;
  --hima-good:var(--dsw-alias-state-success-primary,#8fcb9c);--hima-live:#e59a7a;--hima-warn:var(--dsw-alias-state-warn-primary,#dcb45f);
  --hima-bad:var(--dsw-alias-state-error-primary,#e38f87);--hima-accent:#a3abff;--hima-neutral:#8f8a80;
  --hima-shadow:0 1px 2px rgba(0,0,0,.4),0 10px 28px rgba(0,0,0,.35);
}
/* HIMA CLIENT TOKENS END */
.hima-root *{box-sizing:border-box}
.hima-root button,.hima-root input,.hima-root select{font:inherit}
.hima-root :focus-visible{outline:2px solid var(--hima-accent);outline-offset:2px}
/* C6: the node's own <g> carries tabIndex, so the UA's default focus-visible ring boxed the
   whole group — node shape, id label and caption all together — rather than the node's own shape.
   outline:none on the group defers to this file's own ring, drawn on the hit rect alone (the same
   transparent rect that carries data-hima-control, first child of the group), at the same 2px
   accent the general rule above already uses. */
.hima-node:focus-visible{outline:none}
.hima-node:focus-visible>rect[data-hima-control]{outline:2px solid var(--hima-accent);outline-offset:2px}
.hima-button,.hima-icon-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:var(--hima-sp-2);border:1px solid var(--hima-line);border-radius:var(--hima-r-s);background:var(--hima-paper);color:var(--hima-ink);padding:var(--hima-sp-2) var(--hima-sp-3);min-height:32px;font-size:var(--hima-fs-body);cursor:pointer;white-space:nowrap}
.hima-button:hover,.hima-icon-button:hover{background:var(--hima-soft)}
.hima-button:disabled,.hima-icon-button:disabled{opacity:.5;cursor:default}
.hima-icon-button{padding:var(--hima-sp-1) var(--hima-sp-2);border-color:transparent}
.hima-primary{background:var(--hima-ink);color:var(--hima-on-solid);border-color:var(--hima-ink);font-weight:600}
.hima-primary:hover{background:var(--hima-ink-2);border-color:var(--hima-ink-2)}
.hima-brand{display:flex;align-items:center;gap:var(--hima-sp-2);font-size:var(--hima-fs-title);letter-spacing:-.04em;font-weight:650}
.hima-entry button{display:flex;align-items:center;gap:var(--hima-sp-2);width:100%;min-height:36px;border:0;border-radius:var(--hima-r-m);padding:var(--hima-sp-2) var(--hima-sp-3);background:transparent;color:var(--hima-ink);font-size:var(--hima-fs-body);cursor:pointer}
.hima-entry button:hover{background:var(--hima-soft)}
.hima-entry button:disabled{opacity:.5;cursor:default}
.hima-entry[data-wide=false] button{justify-content:center;padding:var(--hima-sp-2)}
.hima-entry p{padding:var(--hima-sp-1) var(--hima-sp-3);font-size:var(--hima-fs-eyebrow);color:var(--hima-ink-2);margin:0}
.hima-notice{padding:var(--hima-sp-2) var(--hima-sp-3);font-size:var(--hima-fs-eyebrow);color:var(--hima-bad);background:var(--hima-soft);overflow-wrap:anywhere}
.hima-empty{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;gap:var(--hima-sp-4);padding:var(--hima-sp-8) var(--hima-sp-6);color:var(--hima-ink-2)}
.hima-empty h3{font-size:var(--hima-fs-display);font-weight:550;color:var(--hima-ink);letter-spacing:-.02em}
.hima-empty p{max-width:340px;font-size:var(--hima-fs-label)}
.hima-empty-glyph{color:var(--hima-accent)}
.hima-detail{padding:var(--hima-sp-4);display:flex;flex-direction:column;gap:var(--hima-sp-3);min-width:0}
.hima-detail h3{font-size:var(--hima-fs-title);font-weight:600}
.hima-detail table{font-size:var(--hima-fs-label);min-width:560px}
.hima-detail pre{font-size:var(--hima-fs-eyebrow);white-space:pre-wrap;overflow-wrap:anywhere}
.hima-detail details summary{font-size:var(--hima-fs-label);cursor:pointer}
.hima-detail a{color:var(--hima-accent)}
.hima-report{line-height:var(--hima-lh-body)}
.hima-evidence>div{padding:var(--hima-sp-2) 0;border-bottom:1px solid var(--hima-line)}
.hima-activity{margin:0 var(--hima-sp-3) var(--hima-sp-3);background:var(--hima-glass);color:var(--hima-glass-ink);border-radius:var(--hima-r-m);display:flex;flex-direction:column;flex:1;min-height:168px;overflow:hidden}
.hima-activity header,.hima-activity footer{display:flex;justify-content:space-between;gap:var(--hima-sp-2);padding:var(--hima-sp-2) var(--hima-sp-3);border-bottom:1px solid var(--hima-glass-line);font-size:var(--hima-fs-eyebrow);color:var(--hima-ink-3)}
.hima-activity header span:first-child{color:var(--hima-glass-ink);font-weight:600}
.hima-activity pre{margin:0;padding:var(--hima-sp-3);overflow:auto;flex:1;font-family:var(--hima-font-mono);font-size:var(--hima-fs-eyebrow);line-height:var(--hima-lh-body);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--hima-glass-ink)}
.hima-activity footer{border-bottom:0;border-top:1px solid var(--hima-glass-line)}
.hima-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--hima-sp-3)}
.hima-fields label{display:flex;flex-direction:column;gap:var(--hima-sp-1);font-size:var(--hima-fs-eyebrow);font-weight:500;min-width:0}
.hima-fields input,.hima-fields select{border:1px solid var(--hima-line);border-radius:var(--hima-r-s);background:var(--hima-paper);color:var(--hima-ink);padding:var(--hima-sp-2);min-width:0;width:100%;font-size:var(--hima-fs-label)}
.hima-fields small{font-size:var(--hima-fs-eyebrow);font-weight:400;color:var(--hima-ink-2)}
.hima-studio-eyebrow{font-size:var(--hima-fs-eyebrow);letter-spacing:var(--hima-track);font-weight:600;color:var(--hima-ink-2);text-transform:uppercase}
.hima-root svg{vertical-align:-0.15em;flex:none}
.hima-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

.hima-studio{position:relative;height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;background:var(--hima-paper);overflow:hidden}
.hima-studio-header{display:flex;align-items:center;gap:var(--hima-sp-2);padding:var(--hima-sp-1) var(--hima-sp-4);min-height:40px;border-bottom:1px solid var(--hima-line);flex:none}
.hima-studio-header select{flex:1;min-width:0}
.hima-studio-header-actions{display:flex;gap:var(--hima-sp-2);margin-inline-start:auto}

/* The Campaign tab (#41 task 5): masthead, view switch, and the HimaFabric canvas that makes the
   Live view. Every colour and every font-size is a token, SVG text included — an SVG user unit at
   scale 1 is a CSS pixel, so the same --hima-fs-* steps that size the rest of the sheet size the
   canvas's own labels, chips and badges too. */
.hima-campaign{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.hima-masthead{display:flex;align-items:flex-start;gap:var(--hima-sp-3);height:66px;box-sizing:border-box;padding:var(--hima-sp-3) var(--hima-sp-4) 0;border-bottom:1px solid var(--hima-line);flex:none}
.hima-masthead-id{flex:1;min-width:0}
.hima-masthead h2{margin:0;font-size:var(--hima-fs-title);font-weight:600;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hima-masthead-sub{margin:3px 0 0;font-size:var(--hima-fs-label);color:var(--hima-ink-2);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hima-masthead-seal{font-weight:600;color:var(--hima-ink)}
.hima-masthead-seal-running{color:var(--hima-live)}
.hima-masthead-seal-waiting,.hima-masthead-seal-cancelled,.hima-masthead-seal-ended-converged{color:var(--hima-warn)}
.hima-masthead-seal-ended-goal-met{color:var(--hima-good)}
.hima-masthead-seal-ended-goal-not-met,.hima-masthead-seal-ended-budget-exhausted{color:var(--hima-bad)}
.hima-masthead-owner{display:flex;align-items:center;gap:var(--hima-sp-2);font-size:var(--hima-fs-label);color:var(--hima-ink-2);flex:none;white-space:nowrap}
.hima-campaign-views{height:36px;box-sizing:border-box;display:flex;gap:var(--hima-sp-5);padding:0 var(--hima-sp-4);border-bottom:1px solid var(--hima-line);flex:none}
.hima-campaign-views button{appearance:none;border:0;border-bottom:2px solid transparent;padding:var(--hima-sp-2) 0;background:none;cursor:pointer;font-size:var(--hima-fs-label);color:var(--hima-ink-2)}
.hima-campaign-views button[aria-pressed=true]{color:var(--hima-ink);border-bottom-color:var(--hima-live);font-weight:650}
.hima-campaign-content{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:auto}
.hima-campaign-stale{flex:none;padding:var(--hima-sp-2) var(--hima-sp-4);font-size:var(--hima-fs-label);color:var(--hima-warn);background:var(--hima-soft)}

.hima-canvas-wrap{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.hima-canvas-attention{flex:none;min-height:32px;box-sizing:border-box;display:flex;align-items:center;gap:var(--hima-sp-3);padding:var(--hima-sp-1) var(--hima-sp-4);font-size:var(--hima-fs-label)}
.hima-canvas-attention span:first-child{flex:1;min-width:0;overflow-wrap:anywhere}
.hima-canvas-attention-waiting{color:var(--hima-warn);background:var(--hima-soft)}
.hima-canvas-attention-fence{color:var(--hima-ink-2);background:var(--hima-soft)}
.hima-canvas{position:relative;flex:1;min-height:0;min-width:0;background:var(--hima-soft);overflow:hidden}
.hima-canvas svg{display:block;cursor:grab;touch-action:none}
.hima-canvas-stale{opacity:.6}
.hima-canvas-legend{position:absolute;left:var(--hima-sp-4);top:var(--hima-sp-3);display:flex;gap:var(--hima-sp-4);font-size:var(--hima-fs-eyebrow);color:var(--hima-ink-3);pointer-events:none}
.hima-canvas-legend span{display:inline-flex;align-items:center;gap:var(--hima-sp-1)}
.hima-legend-shape{fill:none;stroke:var(--hima-ink-3);stroke-width:1.3}
.hima-canvas-tools{position:absolute;right:var(--hima-sp-3);bottom:var(--hima-sp-3);z-index:6;display:flex;gap:var(--hima-sp-1)}

/* The zoom/pan transform: eased on a follow, instant while reduced motion or a stale snapshot ask
   for none — .hima-canvas-transform-still is set by the same motionOff flag that also gates the
   running pulse and the lit-edge/revisit animations below, and the media query is a backstop for a
   viewer whose OS setting this component's own JS check somehow missed. */
.hima-canvas-transform{transition:transform 300ms ease}
.hima-canvas-transform-still{transition:none}
@media (prefers-reduced-motion: reduce){ .hima-canvas-transform{transition:none} }

.hima-frame-box{fill:none;stroke:var(--hima-line-strong);stroke-dasharray:3 3}
.hima-frame-open .hima-frame-box{stroke:var(--hima-accent)}
.hima-frame-label{font-size:var(--hima-fs-label);fill:var(--hima-ink-2)}

.hima-arrow-fill{fill:var(--hima-line-strong)}
.hima-arrow-fill-lit{fill:var(--hima-good)}
.hima-edge-path{fill:none;stroke:var(--hima-line-strong);stroke-width:1.4}
.hima-edge-lit .hima-edge-path{stroke:var(--hima-good);stroke-width:2}
.hima-edge-path.hima-edge-dashed{stroke-dasharray:5 4}
.hima-edge-revisit .hima-edge-path{stroke:var(--hima-accent)}
.hima-edge-lit-enter .hima-edge-path{stroke-dasharray:8 4;animation:hima-edge-light .5s ease-out}
@keyframes hima-edge-light{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}
.hima-edge-revisit-pulse .hima-edge-path{animation:hima-revisit-pulse 900ms ease-out}
@keyframes hima-revisit-pulse{0%{stroke-width:1.4;opacity:.5}40%{stroke-width:3.5;opacity:1}100%{stroke-width:1.4;opacity:1}}
.hima-edge-chip rect{fill:var(--hima-paper);stroke:var(--hima-line-strong)}
.hima-edge-chip text{font-size:var(--hima-fs-label);font-weight:600;fill:var(--hima-ink-2);text-anchor:middle}
.hima-edge-chip-pass rect{stroke:var(--hima-good)} .hima-edge-chip-pass text{fill:var(--hima-good)}
.hima-edge-chip-fail rect{stroke:var(--hima-bad)} .hima-edge-chip-fail text{fill:var(--hima-bad)}
.hima-edge-chip-undetermined rect{stroke:var(--hima-warn)} .hima-edge-chip-undetermined text{fill:var(--hima-warn)}
.hima-edge-badge rect{fill:var(--hima-paper);stroke:var(--hima-accent)}
.hima-edge-badge text{font-size:var(--hima-fs-label);font-weight:600;fill:var(--hima-accent);text-anchor:middle}

.hima-node{cursor:pointer}
.hima-node-shape{fill:var(--hima-paper);stroke:var(--hima-line-strong);stroke-width:1.4}
.hima-node-state-available .hima-node-shape{stroke:var(--hima-accent)}
.hima-node-state-running .hima-node-shape{stroke:var(--hima-live);stroke-width:2;fill:var(--hima-soft)}
.hima-node-state-waiting-for-slot .hima-node-shape{stroke:var(--hima-warn)}
.hima-node-state-retrying .hima-node-shape{stroke:var(--hima-warn)}
.hima-node-state-blocked .hima-node-shape{stroke:var(--hima-bad)}
.hima-node-state-cancelled .hima-node-shape{stroke:var(--hima-neutral)}
.hima-node-state-done .hima-node-shape{fill:var(--hima-good);stroke:var(--hima-good)}
.hima-node-state-reconciled .hima-node-shape{stroke:var(--hima-ink-2);stroke-dasharray:4 2}
.hima-node-faded{opacity:.55}
.hima-node-mark-chooser{fill:none;stroke:var(--hima-line-strong);stroke-width:1.4}
.hima-node-running-dot{fill:var(--hima-live)}
.hima-node-running-pulse{fill:none;stroke:var(--hima-live);stroke-width:1.5;animation:hima-node-pulse 1.6s ease-out infinite}
@keyframes hima-node-pulse{0%{opacity:.9;r:8}100%{opacity:0;r:15}}
.hima-node-glyph-waiting,.hima-node-glyph-retrying,.hima-node-glyph-cancelled,.hima-node-glyph-reconciled{color:var(--hima-ink-2)}
.hima-node-glyph-blocked{color:var(--hima-bad)}
.hima-node-glyph-done{color:var(--hima-on-solid)}
.hima-node-badge-blocked{fill:var(--hima-bad)}
.hima-node-dashed-segment{stroke:var(--hima-ink-2);stroke-width:1.4;stroke-dasharray:2 2}
.hima-node-bar-track{fill:var(--hima-line-strong)}
.hima-node-bar-fill{fill:var(--hima-live)}
.hima-node-bar-blocked .hima-node-bar-fill,.hima-node-bar-cancelled .hima-node-bar-fill{fill:var(--hima-bad)}
.hima-node-mark-changed{fill:var(--hima-accent)}
.hima-node-mark-waited{color:var(--hima-warn)}
.hima-node-hatch-line{stroke:var(--hima-line-strong);stroke-width:2}
.hima-node-label{font-size:var(--hima-fs-label);font-weight:600;fill:var(--hima-ink);text-anchor:middle}
.hima-node-caption{font-size:var(--hima-fs-label);fill:var(--hima-ink-3);text-anchor:middle}
.hima-node-log{font-size:var(--hima-fs-eyebrow);font-family:var(--hima-font-mono);fill:var(--hima-live);text-anchor:middle}
.hima-node-labels-hidden{visibility:hidden}
.hima-node-current-ring{fill:none;stroke:var(--hima-accent);stroke-width:2}
/* C6: a selected node's own halo — the same accent available/CurrentRing already share, at 40%
   opacity so it reads distinctly from the full-opacity current-node ring (4px offset) when a person
   selects the currently-running node; the halo sits 6px past the node's own form. */
.hima-node-selected-halo{fill:none;stroke:var(--hima-accent);stroke-width:2;opacity:.4}

.hima-goal-roundel{fill:var(--hima-paper);stroke:var(--hima-neutral);stroke-width:1.4;stroke-dasharray:4 3}
.hima-goal-mark{fill:none;stroke:var(--hima-neutral);stroke-width:1.4}
.hima-goal-mark-dot{fill:var(--hima-neutral)}
.hima-goal-label{font-size:var(--hima-fs-label);font-weight:600;fill:var(--hima-ink-2);text-anchor:middle}
.hima-goal-value{font-size:var(--hima-fs-label);font-weight:600;fill:var(--hima-ink);text-anchor:middle}
.hima-goal-seal{stroke:none;fill:var(--hima-neutral)}
/* C13: the seal's own second, concentric ring (2px, 4px gap past r=26) — never drawn by a done
   node (r=18, no ring at all), so a sealed Goal reads as its own distinct mark rather than an
   oversized done node. Coloured the same as the seal's own fill, per status, below. */
.hima-goal-seal-ring{fill:none;stroke-width:2;stroke:var(--hima-neutral)}
[data-hima-region="campaign-goal"][data-hima-state-status="ended-goal-met"] .hima-goal-seal{fill:var(--hima-good)}
[data-hima-region="campaign-goal"][data-hima-state-status="ended-goal-met"] .hima-goal-seal-ring{stroke:var(--hima-good)}
[data-hima-region="campaign-goal"][data-hima-state-status="ended-goal-not-met"] .hima-goal-seal,
[data-hima-region="campaign-goal"][data-hima-state-status="ended-budget-exhausted"] .hima-goal-seal{fill:var(--hima-bad)}
[data-hima-region="campaign-goal"][data-hima-state-status="ended-goal-not-met"] .hima-goal-seal-ring,
[data-hima-region="campaign-goal"][data-hima-state-status="ended-budget-exhausted"] .hima-goal-seal-ring{stroke:var(--hima-bad)}
[data-hima-region="campaign-goal"][data-hima-state-status="ended-converged"] .hima-goal-seal,
[data-hima-region="campaign-goal"][data-hima-state-status="cancelled"] .hima-goal-seal{fill:var(--hima-warn)}
[data-hima-region="campaign-goal"][data-hima-state-status="ended-converged"] .hima-goal-seal-ring,
[data-hima-region="campaign-goal"][data-hima-state-status="cancelled"] .hima-goal-seal-ring{stroke:var(--hima-warn)}
.hima-goal-seal-glyph{color:var(--hima-on-solid)}
.hima-goal-title{font-size:var(--hima-fs-display);font-weight:650;fill:var(--hima-ink);text-anchor:middle}
.hima-goal-reason{font-size:var(--hima-fs-label);fill:var(--hima-ink-2);text-anchor:middle}

@media (prefers-reduced-motion: reduce){
  .hima-node-running-pulse{animation:none}
  .hima-edge-lit-enter .hima-edge-path{animation:none}
  .hima-edge-revisit-pulse .hima-edge-path{animation:none}
}

/* The node card (#41 task 6): a plain HTML overlay anchored to its node, a sibling of the canvas's
   own <svg> and never a <foreignObject> inside it (so its wheel scroll, text selection and pointer
   events are its own DOM events, never the canvas's — see client/FabricCanvas.tsx and NodeCard.tsx),
   kind-specific tabs, a dark glass Job log, and the owner/non-owner footer. Its left/top are set
   by NodeCard.tsx through the DOM style property directly (never a JSX inline style prop, which
   this file's own contract test bans) — a canvas-anchored overlay's position is a per-render layout
   computation no static class can state, exactly as card-labels.ts's own colour strings (good/bad/
   warn/plain) are read here as data-state/data-outcome attributes instead of client-side colour code. */
.hima-node-card{position:absolute;left:0;top:0;z-index:5;box-sizing:border-box;width:384px;height:300px;display:flex;flex-direction:column;background:var(--hima-paper);color:var(--hima-ink);border:1px solid var(--hima-line);border-radius:var(--hima-r-l);box-shadow:var(--hima-shadow);overflow:hidden;font-family:var(--hima-font-ui);font-size:var(--hima-fs-body)}
.hima-node-card-header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--hima-sp-2);padding:var(--hima-sp-3) var(--hima-sp-3) var(--hima-sp-2);border-bottom:1px solid var(--hima-line);flex:none}
.hima-node-card-header h4{margin:0;font-size:var(--hima-fs-title);font-weight:600}
.hima-node-card-header p{margin:2px 0 0;font-size:var(--hima-fs-label)}
.hima-node-card-tabs{display:flex;gap:var(--hima-sp-4);padding:0 var(--hima-sp-3);border-bottom:1px solid var(--hima-line);flex:none;overflow-x:auto}
.hima-node-card-tabs button{appearance:none;border:0;border-bottom:2px solid transparent;padding:var(--hima-sp-2) 0;background:none;cursor:pointer;font-size:var(--hima-fs-label);color:var(--hima-ink-2);white-space:nowrap}
.hima-node-card-tabs button[aria-pressed=true]{color:var(--hima-ink);border-bottom-color:var(--hima-live);font-weight:650}
.hima-node-card-content{flex:1;min-height:0;overflow:auto;padding:var(--hima-sp-3);display:flex;flex-direction:column;gap:var(--hima-sp-2)}
.hima-node-card-content h5{margin:var(--hima-sp-2) 0 0;font-size:var(--hima-fs-label);letter-spacing:var(--hima-track);font-weight:600;color:var(--hima-ink-2);text-transform:uppercase}
.hima-node-card-content ol,.hima-node-card-content ul{margin:0;padding-left:var(--hima-sp-4);display:flex;flex-direction:column;gap:2px}
.hima-node-card-tail{margin:0;padding:var(--hima-sp-2);background:var(--hima-glass);color:var(--hima-glass-ink);border-radius:var(--hima-r-m);font-family:var(--hima-font-mono);font-size:var(--hima-fs-eyebrow);line-height:var(--hima-lh-body);white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto;max-height:160px}
.hima-node-card-footer{flex:none;padding:var(--hima-sp-2) var(--hima-sp-3);border-top:1px solid var(--hima-line);display:flex;flex-direction:column;gap:var(--hima-sp-2);font-size:var(--hima-fs-label)}
.hima-node-card-footer-row{display:flex;justify-content:flex-end;gap:var(--hima-sp-2);flex-wrap:wrap}
.hima-node-card-confirm{display:flex;flex-direction:column;gap:var(--hima-sp-2);padding:var(--hima-sp-2);background:var(--hima-soft);border-radius:var(--hima-r-m)}
.hima-node-card-confirm p{margin:0}
.hima-node-card-owner{color:var(--hima-ink-2)}
.hima-node-card-emergency summary{cursor:pointer;font-size:var(--hima-fs-label);color:var(--hima-ink-2)}
.hima-material-row{appearance:none;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;text-align:left;padding:var(--hima-sp-1) var(--hima-sp-2);border-radius:var(--hima-r-s)}
.hima-material-row:hover{background:var(--hima-soft)}

/* One state or outcome word, coloured by its own attribute rather than by a string the client held —
   the same four tones (good/bad/warn/plain) card-labels.ts states, applied here through
   CSS attribute selectors so no colour string travels through client code. */
.hima-state-word,.hima-outcome-word{font-weight:500}
.hima-state-word[data-state="done"],.hima-state-word[data-state="ended-goal-met"],.hima-state-word[data-state="goal-met"]{color:var(--hima-good)}
.hima-state-word[data-state="blocked"],.hima-state-word[data-state="ended-goal-not-met"],.hima-state-word[data-state="ended-budget-exhausted"],.hima-state-word[data-state="failed"],.hima-state-word[data-state="not-taken"]{color:var(--hima-bad)}
.hima-state-word[data-state="waiting"],.hima-state-word[data-state="waiting-for-slot"],.hima-state-word[data-state="retrying"],.hima-state-word[data-state="cancelled"],.hima-state-word[data-state="ended-converged"],.hima-state-word[data-state="converged"],.hima-state-word[data-state="no-entry"],.hima-state-word[data-state="interrupted"],.hima-state-word[data-state="generation-limit"],.hima-state-word[data-state="refused"]{color:var(--hima-warn)}
.hima-state-word[data-state="pending"],.hima-state-word[data-state="running"],.hima-state-word[data-state="reconciled"],.hima-state-word[data-state="writing"],.hima-state-word[data-state="written"],.hima-state-word[data-state="awaiting-completion"]{color:var(--hima-ink)}
.hima-outcome-word[data-outcome="PASS"],.hima-outcome-word[data-outcome="next-strategy"],.hima-outcome-word[data-outcome="goal-met"]{color:var(--hima-good)}
.hima-outcome-word[data-outcome="FAIL"]{color:var(--hima-bad)}
.hima-outcome-word[data-outcome="UNDETERMINED"]{color:var(--hima-warn)}
.hima-outcome-word[data-outcome="converged"],.hima-outcome-word[data-outcome="open"]{color:var(--hima-ink-2)}

/* The restyled tool receipt and its shared row/section components (#41 task 6): no inline style. */
.hima-run-card{display:flex;flex-direction:column;gap:var(--hima-sp-2);font-size:var(--hima-fs-label);line-height:var(--hima-lh-body)}
.hima-run-card-receipt{display:flex;flex-direction:column;gap:2px}
.hima-run-card-receipt-line{display:flex;gap:4px;flex-wrap:wrap;align-items:baseline}
.hima-run-card-receipt-notice{color:var(--hima-ink-2)}
.hima-receipt-body{max-height:220px;overflow:auto}
.hima-run-card details[data-hima-control="receipt-details"]{margin-top:var(--hima-sp-1)}
.hima-run-card details[data-hima-control="receipt-details"]>summary{cursor:pointer;font-size:var(--hima-fs-label);color:var(--hima-ink-2)}
.hima-run-card-section{display:flex;flex-direction:column;gap:4px}
.hima-run-card-heading{color:var(--hima-ink-2);text-transform:uppercase;letter-spacing:var(--hima-track);font-size:var(--hima-fs-label)}
.hima-block{display:flex;flex-direction:column;gap:2px;padding-left:12px;border-left:2px solid var(--hima-line)}
.hima-path-row{display:flex;gap:8px;align-items:baseline}
.hima-path-index{min-width:16px;text-align:right}
.hima-path-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.hima-run-card-control-row{display:flex;flex-direction:column;gap:6px}
.hima-run-card-control-buttons{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hima-run-card-error{color:var(--hima-bad)}
.hima-wrap{overflow-wrap:anywhere}
.hima-run-card-archive-row{font-family:var(--hima-font-mono);overflow-wrap:anywhere;display:block;width:100%;text-align:left;margin:5px 0}
.hima-logtail{font-family:var(--hima-font-mono);overflow-wrap:anywhere;white-space:pre-wrap;max-height:180px;overflow:auto;margin:0;padding:6px;background:var(--hima-glass);color:var(--hima-glass-ink);border-radius:var(--hima-r-m);font-size:var(--hima-fs-eyebrow)}
.hima-run-card .hima-meter-grid{display:grid;grid-template-columns:max-content 96px minmax(0,max-content);gap:2px 8px;align-items:center}
.hima-meter-bar{overflow:visible}
.hima-meter-track{fill:var(--hima-line)}
.hima-meter-fill{fill:var(--hima-ink)}
.hima-meter-fill[data-hima-spent=true]{fill:var(--hima-bad)}
.hima-meter-tick{fill:var(--hima-ink-3)}
.hima-run-card-ledger{overflow-x:auto}
.hima-run-card-ledger table{border-collapse:collapse;font:inherit}
.hima-run-card-ledger th{color:var(--hima-ink-2);text-align:left;font-weight:500;padding:2px 12px 2px 0;white-space:nowrap}
.hima-run-card-cell{text-align:left;vertical-align:top;padding:2px 12px 2px 0;border-top:1px solid var(--hima-line)}
.hima-run-card-cell-nested{padding-left:12px;border-left:2px solid var(--hima-line)}
.hima-run-card-material-row{display:grid;grid-template-columns:minmax(0,1fr) 104px;gap:12px;align-items:center;width:100%;text-align:left;border:0;border-radius:5px;background:transparent;color:var(--hima-ink);cursor:pointer;padding:7px 8px;font-family:var(--hima-font-mono)}
.hima-run-card-material-row[data-selected=true]{background:var(--hima-soft)}
.hima-run-card-material-row span:first-child{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.hima-run-card-material-row span:last-child{color:var(--hima-ink-2);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.hima-run-card-report-code{font-family:var(--hima-font-mono);overflow-wrap:anywhere;margin:0;padding:8px;overflow-x:auto;white-space:pre-wrap;background:var(--hima-soft)}
.hima-run-card-report-heading{font-weight:600;margin-top:4px}
.hima-run-card-report-heading[data-level="1"]{font-size:var(--hima-fs-body)}
.hima-run-card-report-heading[data-level="2"]{font-size:var(--hima-fs-label)}
.hima-run-card-report-heading[data-level="3"]{font-size:var(--hima-fs-eyebrow)}
.hima-run-card-report-paragraph{line-height:20px}
.hima-run-card-material-panel{max-height:240px;overflow:auto}
.hima-run-card-material-panel table{width:100%;table-layout:fixed;font-size:var(--hima-fs-eyebrow);text-align:left}
.hima-run-card-owner-textarea{box-sizing:border-box;width:100%;min-height:72px;resize:vertical;padding:10px;font:inherit;color:inherit;background:transparent;border:1px solid var(--hima-line);border-radius:6px}
.hima-owner-fieldset{border:0;padding:0;min-width:0;display:grid;gap:14px}
.hima-owner-assets-label{display:grid;gap:8px}
.hima-owner-review-button{justify-self:start}
.hima-owner-file-column{width:56%}
.hima-owner-bytes-column{width:16%}
.hima-owner-file-cell{padding:8px 6px 8px 0;overflow-wrap:anywhere}

/* The Configuration page (#41 task 7): the Campaign file rendered as one document, every section
   visible at once — never a wizard. A two-column grid per section (a 12 px tracked eyebrow naming
   it, its content stacked beneath), the same label/body/eyebrow steps the rest of the sheet uses. */
.hima-config{flex:1;min-height:0;min-width:0;overflow:auto;padding:var(--hima-sp-5) var(--hima-sp-6) var(--hima-sp-8);display:flex;flex-direction:column}
.hima-config-header{padding-bottom:var(--hima-sp-3);margin-bottom:var(--hima-sp-2);border-bottom:1px solid var(--hima-line-strong)}
.hima-config-header h2{margin:0;font-size:var(--hima-fs-title);font-weight:650;letter-spacing:-.01em}
.hima-config-header-sub{margin:4px 0 0;font-size:var(--hima-fs-label);color:var(--hima-ink-2)}
.hima-config>section{display:grid;grid-template-columns:150px minmax(0,1fr);gap:6px var(--hima-sp-4);padding:var(--hima-sp-3) 0;border-bottom:1px solid var(--hima-line);align-items:start}
.hima-config-eyebrow{font-size:var(--hima-fs-eyebrow);letter-spacing:var(--hima-track);font-weight:600;color:var(--hima-ink-2);text-transform:uppercase;padding-top:6px}
.hima-config>section>*{grid-column:2;min-width:0}
.hima-config>section>.hima-config-eyebrow{grid-column:1}
.hima-config-detail{margin:0;font-size:var(--hima-fs-label);color:var(--hima-ink-2)}
.hima-config select,.hima-config input,.hima-config textarea{border:1px solid var(--hima-line);border-radius:var(--hima-r-s);background:var(--hima-paper);color:var(--hima-ink);padding:6px var(--hima-sp-2);font-size:var(--hima-fs-label);min-width:0}
.hima-config textarea{min-height:48px;resize:vertical;width:100%}
.hima-config-field-row{display:flex;align-items:center;gap:var(--hima-sp-2);flex-wrap:wrap}
.hima-config-field-row+.hima-config-field-row{margin-top:6px}
.hima-config-field-row>span:first-child{min-width:120px;font-size:var(--hima-fs-label);color:var(--hima-ink)}
.hima-config-mark{font-size:var(--hima-fs-eyebrow);color:var(--hima-accent);font-weight:600}
.hima-changed{background:color-mix(in srgb, var(--hima-accent) 10%, transparent);border-radius:var(--hima-r-s)}
.hima-config-mini-graph-wrap{max-width:100%;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin;padding-right:4px}
.hima-config-mini-graph{display:block}
.hima-config-mini-node{fill:var(--hima-paper);stroke:var(--hima-ink-2);stroke-width:1.25;vector-effect:non-scaling-stroke}
.hima-config-mini-edge{fill:none;stroke:var(--hima-line-strong);stroke-width:1;vector-effect:non-scaling-stroke}
.hima-config-mini-edge-revisit{fill:none;stroke:var(--hima-accent);stroke-width:1;stroke-dasharray:3 2;vector-effect:non-scaling-stroke}
.hima-config-mini-goal{fill:none;stroke:var(--hima-neutral);stroke-width:1.25;stroke-dasharray:3 2;vector-effect:non-scaling-stroke}
.hima-config-empty-pack,.hima-config-knowledge-add-row{display:flex;gap:var(--hima-sp-2);align-items:center;flex-wrap:wrap}
.hima-config-site-new{display:flex;flex-direction:column;gap:var(--hima-sp-2);margin-top:6px}
.hima-config-site-new-label{display:flex;flex-direction:column;gap:2px;font-size:var(--hima-fs-eyebrow);color:var(--hima-ink-2)}
.hima-config-readiness-row{display:flex;align-items:center;gap:var(--hima-sp-2);flex-wrap:wrap}
.hima-config-readiness-row{padding:2px 0}
.hima-config-confirm-row{display:flex;align-items:center;gap:var(--hima-sp-3);margin-top:var(--hima-sp-2)}
.hima-pill{display:inline-flex;align-items:center;padding:1px 8px;border-radius:999px;background:var(--hima-soft);color:var(--hima-ink-2);font-size:var(--hima-fs-eyebrow);font-weight:600;margin-left:6px}

/* Shell integration (#41 task 8): the session-header Campaign chip, the tab title, the tab's own
   Diagnostics sheet and the HimaHarness settings section. */
/* C9: hima-campaign-chip-wrap (the mount's own outer span) never stretches inside the shell's own
   header actions flexbox — flex:none plus min-width:0 — so the chip sits at its own natural width
   beside the shell's own header chips instead of colliding with them. The node span inside the chip
   (hima-campaign-chip-node) is capped at 200px and ellipsized rather than left to grow unbounded on
   a long node id, which was the other half of the same collision. */
.hima-campaign-chip-wrap{display:inline-flex;flex:none;min-width:0}
.hima-campaign-chip{display:inline-flex;align-items:center;gap:var(--hima-sp-1);border:0;border-radius:var(--hima-r-s);background:transparent;color:var(--hima-ink-2);font-size:var(--hima-fs-label);line-height:1;padding:var(--hima-sp-1) var(--hima-sp-2);cursor:pointer;min-width:0}
.hima-campaign-chip:hover{background:var(--hima-soft);color:var(--hima-ink)}
.hima-campaign-chip-node{max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hima-campaign-chip-badge{width:6px;height:6px;border-radius:50%;background:var(--hima-live);display:inline-block}
.hima-tab-title{display:inline-flex;align-items:center;gap:var(--hima-sp-1)}
.hima-campaign-chip[data-hima-state-stale="true"],.hima-tab-title[data-hima-state-stale="true"]{opacity:.55}
.hima-tab-menu-item{appearance:none;display:block;width:100%;text-align:left;border:0;border-radius:var(--hima-r-s);background:transparent;color:var(--hima-ink);padding:var(--hima-sp-2) var(--hima-sp-3);font-size:var(--hima-fs-body);cursor:pointer}
.hima-tab-menu-item:hover{background:var(--hima-soft)}
.hima-diagnostics{position:absolute;right:var(--hima-sp-4);bottom:var(--hima-sp-4);width:320px;max-width:calc(100% - var(--hima-sp-8));max-height:70%;overflow:auto;background:var(--hima-paper);border:1px solid var(--hima-line);border-radius:var(--hima-r-l);box-shadow:var(--hima-shadow);padding:var(--hima-sp-3);display:flex;flex-direction:column;gap:var(--hima-sp-2);z-index:20}
.hima-diagnostics-header{display:flex;align-items:center;justify-content:space-between;gap:var(--hima-sp-2)}
.hima-diagnostics-facts{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px var(--hima-sp-2);font-size:var(--hima-fs-label);margin:0}
.hima-diagnostics-facts dt{color:var(--hima-ink-2)}
.hima-diagnostics-facts dd{margin:0;overflow-wrap:anywhere}
.hima-diagnostics-meters{display:flex;flex-direction:column;gap:2px}
.hima-diagnostics-line{margin:0;background:var(--hima-glass);color:var(--hima-glass-ink);padding:var(--hima-sp-2);border-radius:var(--hima-r-s);font-family:var(--hima-font-mono);font-size:var(--hima-fs-eyebrow);white-space:pre-wrap;overflow-wrap:anywhere}
.hima-owner-location-row{display:flex;align-items:center;gap:var(--hima-sp-1)}
.hima-owner-location-row input{flex:1;min-width:0}
.hima-settings{display:flex;flex-direction:column;gap:var(--hima-sp-5);padding:var(--hima-sp-2) 0}
.hima-settings h3{margin:0 0 var(--hima-sp-2);font-size:var(--hima-fs-title);font-weight:600}
.hima-settings-sites{display:flex;flex-direction:column;gap:var(--hima-sp-2)}
.hima-settings-row{display:flex;align-items:center;gap:var(--hima-sp-2);flex-wrap:wrap;padding:var(--hima-sp-1) 0}
.hima-settings-packs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--hima-sp-1)}

/* Every mount that reaches for these three since before this task existed to give them a rule
   (review MINOR, task 8): mono for raw ids and hashes, muted for the secondary ink, small for the
   label step everywhere a caption or a sentence beside a fact is not the body's own size. */
.hima-mono{font-family:var(--hima-font-mono);font-size:var(--hima-fs-label)}
.hima-muted{color:var(--hima-ink-2)}
.hima-small{font-size:var(--hima-fs-label);color:var(--hima-ink-2)}
`;
