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

.hima-studio{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;background:var(--hima-paper);overflow:hidden}
.hima-studio-header{display:flex;align-items:center;gap:var(--hima-sp-2);padding:var(--hima-sp-2) var(--hima-sp-4);border-bottom:1px solid var(--hima-line);flex:none}
.hima-studio-header>div{flex:1;min-width:0}
.hima-run-picker{display:flex;align-items:center;gap:var(--hima-sp-2);padding:var(--hima-sp-2) var(--hima-sp-4);border-bottom:1px solid var(--hima-line);flex:none}
.hima-run-picker select{flex:1;min-width:0}
.hima-run-controls-interim{padding:var(--hima-sp-2) var(--hima-sp-4);border-bottom:1px solid var(--hima-line);flex:none;font-size:var(--hima-fs-label);color:var(--hima-ink-2)}
.hima-run-controls-interim button{appearance:none;border:1px solid var(--hima-line);border-radius:var(--hima-r-s);background:var(--hima-paper);color:var(--hima-ink);padding:var(--hima-sp-1) var(--hima-sp-2);font-size:var(--hima-fs-label);cursor:pointer;margin:var(--hima-sp-1) var(--hima-sp-1) 0 0}
.hima-run-controls-interim button:hover{background:var(--hima-soft)}
.hima-run-controls-interim button:disabled{opacity:.5;cursor:default}
.hima-start-form{padding:var(--hima-sp-4);overflow:auto;min-height:0;display:flex;flex-direction:column;gap:var(--hima-sp-4)}

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
.hima-canvas-tools{position:absolute;right:var(--hima-sp-3);bottom:var(--hima-sp-3);display:flex;gap:var(--hima-sp-1)}

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
.hima-branch-label{font-size:var(--hima-fs-label);font-weight:600;fill:var(--hima-ink-2)}

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

.hima-goal-roundel{fill:var(--hima-paper);stroke:var(--hima-neutral);stroke-width:1.4;stroke-dasharray:4 3}
.hima-goal-mark{fill:none;stroke:var(--hima-neutral);stroke-width:1.4}
.hima-goal-mark-dot{fill:var(--hima-neutral)}
.hima-goal-label{font-size:var(--hima-fs-label);font-weight:600;fill:var(--hima-ink-2);text-anchor:middle}
.hima-goal-seal{stroke:none;fill:var(--hima-neutral)}
[data-hima-region="campaign-goal"][data-hima-state-status="ended-goal-met"] .hima-goal-seal{fill:var(--hima-good)}
[data-hima-region="campaign-goal"][data-hima-state-status="ended-goal-not-met"] .hima-goal-seal,
[data-hima-region="campaign-goal"][data-hima-state-status="ended-budget-exhausted"] .hima-goal-seal{fill:var(--hima-bad)}
[data-hima-region="campaign-goal"][data-hima-state-status="ended-converged"] .hima-goal-seal,
[data-hima-region="campaign-goal"][data-hima-state-status="cancelled"] .hima-goal-seal{fill:var(--hima-warn)}
.hima-goal-title{font-size:var(--hima-fs-display);font-weight:650;fill:var(--hima-on-solid);text-anchor:middle}
.hima-goal-reason{font-size:var(--hima-fs-label);fill:var(--hima-on-solid);text-anchor:middle}

@media (prefers-reduced-motion: reduce){
  .hima-node-running-pulse{animation:none}
  .hima-edge-lit-enter .hima-edge-path{animation:none}
  .hima-edge-revisit-pulse .hima-edge-path{animation:none}
}
`;
