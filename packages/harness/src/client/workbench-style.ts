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
  --hima-shadow:0 1px 2px rgba(20,18,15,.06),0 12px 28px rgba(20,18,15,.08);
  color:var(--hima-ink);font-family:var(--hima-font-ui);font-size:var(--hima-fs-body);line-height:var(--hima-lh-body);font-variant-numeric:tabular-nums;
}
@media (prefers-color-scheme:dark){.hima-root{
  --hima-paper:var(--dsw-alias-background-primary,#1c1b1c);--hima-soft:var(--dsw-alias-fill-secondary,#252422);
  --hima-line:var(--dsw-alias-border-l2,#3a3733);--hima-line-strong:#ffffff29;
  --hima-ink:var(--dsw-alias-label-primary,#ece8e0);--hima-ink-2:var(--dsw-alias-label-secondary,#b5afa4);--hima-ink-3:var(--dsw-alias-label-tertiary,#8f8a80);
  --hima-on-solid:#1c1b1c;
  --hima-good:var(--dsw-alias-state-success-primary,#8fcb9c);--hima-live:#e59a7a;--hima-warn:var(--dsw-alias-state-warn-primary,#dcb45f);
  --hima-bad:var(--dsw-alias-state-error-primary,#e38f87);--hima-accent:#a3abff;--hima-neutral:#8f8a80;
  --hima-shadow:0 1px 2px rgba(0,0,0,.4),0 12px 28px rgba(0,0,0,.35);
}}
:root[data-theme="dark"] .hima-root{
  --hima-paper:var(--dsw-alias-background-primary,#1c1b1c);--hima-soft:var(--dsw-alias-fill-secondary,#252422);
  --hima-line:var(--dsw-alias-border-l2,#3a3733);--hima-line-strong:#ffffff29;
  --hima-ink:var(--dsw-alias-label-primary,#ece8e0);--hima-ink-2:var(--dsw-alias-label-secondary,#b5afa4);--hima-ink-3:var(--dsw-alias-label-tertiary,#8f8a80);
  --hima-on-solid:#1c1b1c;
  --hima-good:var(--dsw-alias-state-success-primary,#8fcb9c);--hima-live:#e59a7a;--hima-warn:var(--dsw-alias-state-warn-primary,#dcb45f);
  --hima-bad:var(--dsw-alias-state-error-primary,#e38f87);--hima-accent:#a3abff;--hima-neutral:#8f8a80;
  --hima-shadow:0 1px 2px rgba(0,0,0,.4),0 12px 28px rgba(0,0,0,.35);
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
.hima-activity{margin:0 var(--hima-sp-3) var(--hima-sp-3);background:var(--hima-glass);color:var(--hima-glass-ink);border-radius:var(--hima-r-m);display:flex;flex-direction:column;flex:1;min-height:170px;overflow:hidden}
.hima-activity header,.hima-activity footer{display:flex;justify-content:space-between;gap:var(--hima-sp-2);padding:var(--hima-sp-2) var(--hima-sp-3);border-bottom:1px solid var(--hima-glass-line);font-size:var(--hima-fs-eyebrow);color:var(--hima-ink-3)}
.hima-activity header span:first-child{color:var(--hima-glass-ink);font-weight:600}
.hima-activity pre{margin:0;padding:var(--hima-sp-3);overflow:auto;flex:1;font-family:var(--hima-font-mono);font-size:var(--hima-fs-eyebrow);line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--hima-glass-ink)}
.hima-activity footer{border-bottom:0;border-top:1px solid var(--hima-glass-line)}
.hima-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--hima-sp-3)}
.hima-fields label{display:flex;flex-direction:column;gap:var(--hima-sp-1);font-size:var(--hima-fs-eyebrow);font-weight:500;min-width:0}
.hima-fields input,.hima-fields select{border:1px solid var(--hima-line);border-radius:var(--hima-r-s);background:var(--hima-paper);color:var(--hima-ink);padding:var(--hima-sp-2);min-width:0;width:100%;font-size:var(--hima-fs-label)}
.hima-fields small{font-size:var(--hima-fs-eyebrow);font-weight:400;color:var(--hima-ink-2)}
`;

/** @deprecated Use `HIMA_STYLE`. Kept until the last import is removed (Task 5). */
export const STUDIO_STYLE = HIMA_STYLE;
