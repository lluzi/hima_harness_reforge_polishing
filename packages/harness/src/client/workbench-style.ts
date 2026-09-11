// Hima's native dock presentation. The old Hima desktop supplied the layout and material reference;
// all selectors here belong to this client, and all run facts still come from the current Host.
export const STUDIO_STYLE = `
.hima-studio,.hima-entry{
  --hs-bg:var(--dsw-alias-background-primary,#fff);
  --hs-ink:var(--dsw-alias-label-primary,#242321);
  --hs-muted:var(--dsw-alias-label-secondary,#66625c);
  --hs-soft:var(--dsw-alias-fill-secondary,#f6f5f2);
  --hs-line:var(--dsw-alias-border-l2,#e6e3dd);
  --hs-accent:#5966e9;--hs-good:#357e4b;--hs-live:#b95536;--hs-warn:#8b620f;
  --hs-bad:#aa423a;--hs-raw:#151412;--hs-raw-ink:#d5d0c5;
  color:var(--hs-ink);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
}
@media(prefers-color-scheme:dark){.hima-studio,.hima-entry{
  --hs-bg:var(--dsw-alias-background-primary,#1b1b1c);--hs-ink:var(--dsw-alias-label-primary,#ece9e2);
  --hs-muted:var(--dsw-alias-label-secondary,#b3ada3);--hs-soft:var(--dsw-alias-fill-secondary,#242320);
  --hs-line:var(--dsw-alias-border-l2,#3a3731);--hs-accent:#a5adff;
  --hs-good:#96cba0;--hs-live:#e39a7c;--hs-warn:#ddb45f;--hs-bad:#e39089;
}}
.hima-studio *{box-sizing:border-box}
.hima-studio{height:100%;min-height:0;min-width:0;display:flex;flex-direction:column;background:var(--hs-bg);font-size:14px;line-height:1.5;overflow:hidden}
.hima-studio button,.hima-studio input,.hima-studio select,.hima-entry button{font:inherit}
.hima-studio h2,.hima-studio h3,.hima-studio h4,.hima-studio p{margin:0}
.hima-studio-header{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--hs-line);flex:none}
.hima-studio-header>div{flex:1;min-width:0}
.hima-studio-header h2{font-size:17px;font-weight:650;letter-spacing:-.025em}
.hima-studio-eyebrow{font-size:11px;letter-spacing:.08em;font-weight:600;color:var(--hs-muted)}
.hima-button,.hima-icon-button{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--hs-line);border-radius:6px;background:var(--hs-bg);color:var(--hs-ink);padding:6px 10px;min-height:32px;cursor:pointer;white-space:nowrap}
.hima-button:hover,.hima-icon-button:hover{background:var(--hs-soft)}
.hima-primary{background:var(--hs-ink);color:var(--hs-bg);border-color:var(--hs-ink);font-weight:600}
.hima-primary:hover{background:var(--hs-muted);border-color:var(--hs-muted)}
.hima-button:disabled,.hima-entry button:disabled{opacity:.5;cursor:default}
.hima-icon-button{padding:4px 8px;border-color:transparent;font-size:18px}
.hima-studio :focus-visible,.hima-entry :focus-visible{outline:2px solid var(--hs-accent);outline-offset:2px}
.hima-run-picker{display:flex;align-items:center;gap:10px;padding:8px 16px;border-bottom:1px solid var(--hs-line);min-width:0;flex:none}
.hima-run-picker>span{white-space:nowrap}
.hima-run-picker select{flex:1;min-width:0;padding:5px 6px;border:0;background:transparent;color:var(--hs-ink);font-size:12px}
.hima-run-picker option{background:var(--hs-bg);color:var(--hs-ink)}
.hima-studio-tabs{display:flex;gap:18px;border-bottom:1px solid var(--hs-line);padding:0 16px;flex:none;overflow-x:auto}
.hima-studio-tabs button{appearance:none;border:0;border-bottom:2px solid transparent;padding:10px 0;color:var(--hs-muted);background:none;cursor:pointer;white-space:nowrap;font-size:13px}
.hima-studio-tabs button[aria-pressed=true]{color:var(--hs-ink);border-bottom-color:var(--hs-live);font-weight:650}
.hima-studio-content{flex:1;min-height:0;min-width:0;overflow:auto;display:flex;flex-direction:column}
.hima-run-summary{padding:16px 18px 10px;flex:none}
.hima-run-title{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.hima-run-title h3{font-size:16px;font-weight:650;letter-spacing:-.02em;overflow-wrap:anywhere;flex:1;min-width:160px}
.hima-state{font-size:12px;font-weight:600;color:var(--hs-muted);white-space:nowrap}
.hima-state[data-state=running]{color:var(--hs-live)}
.hima-state[data-state=ended-goal-met]{color:var(--hs-good)}
.hima-state[data-state=waiting],.hima-state[data-state=ended-converged]{color:var(--hs-warn)}
.hima-state[data-state=cancelled],.hima-state[data-state=ended-goal-not-met]{color:var(--hs-bad)}
.hima-run-context{font-size:12px;color:var(--hs-muted);margin-top:5px!important;overflow-wrap:anywhere}
.hima-run-context span{margin:0 6px;opacity:.5}
.hima-headlines{display:grid;grid-template-columns:1.2fr 1fr;gap:18px;margin:8px 0;padding-top:8px;border-top:1px solid var(--hs-line)}
.hima-headlines p{margin-top:4px;overflow-wrap:anywhere;font-size:13px}
.hima-metrics{display:grid;grid-template-columns:repeat(3,1fr);background:var(--hs-soft);border:1px solid var(--hs-line);border-radius:6px;padding:10px 12px}
.hima-metrics>div{display:flex;flex-direction:column;gap:3px;min-width:0;padding-left:12px;border-left:1px solid var(--hs-line)}
.hima-metrics>div:first-child{padding-left:0;border-left:0}
.hima-metrics span{font-size:11px;color:var(--hs-muted)}
.hima-metrics strong{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.hima-metrics small{font-size:12px;font-weight:400;color:var(--hs-muted)}
.hima-budget{margin-top:10px;font-size:12px;color:var(--hs-muted)}
.hima-budget summary{cursor:pointer}
.hima-budget dl{margin:8px 0 0}
.hima-budget dl>div{display:grid;grid-template-columns:95px minmax(0,1fr);gap:10px;padding:5px 0;border-top:1px solid var(--hs-line)}
.hima-budget dd{margin:0;overflow-wrap:anywhere}
.hima-blocker{padding:12px;border-left:3px solid var(--hs-warn);background:var(--hs-soft);margin-top:12px;font-size:13px}
.hima-blocker strong{color:var(--hs-warn)}
.hima-blocker p{margin-top:5px;overflow-wrap:anywhere}
.hima-run-controls{padding:0 18px 10px;flex:none}
.hima-run-controls [data-hima-control]{border:1px solid var(--hs-line)!important;color:var(--hs-ink)!important;background:var(--hs-bg)!important;min-height:30px;padding:4px 10px!important;border-radius:5px;font-size:12px!important}
.hima-run-controls [data-hima-region=run-error]:empty{display:none}
.hima-fabric{padding:12px 18px;border-top:1px solid var(--hs-line);flex:none;min-width:0}
.hima-section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
.hima-section-heading h3{font-size:14px;font-weight:650}
.hima-section-heading>span{font-size:11px;color:var(--hs-muted)}
.hima-trace-scroll{overflow-x:auto;border:1px solid var(--hs-line);border-radius:6px;background:var(--hs-soft)}
.hima-trace{display:flex;list-style:none;margin:0;padding:12px 10px 10px;min-width:max-content}
.hima-trace li{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;width:118px;text-align:center;padding:0 5px}
.hima-trace li:before{content:'';position:absolute;left:0;top:12px;width:100%;border-top:1px solid var(--hs-line)}
.hima-trace li:first-child:before{left:50%;width:50%}
.hima-trace li:last-child:before{width:50%}
.hima-trace li:only-child:before{display:none}
.hima-station{position:relative;background:var(--hs-soft);border:1px solid var(--hs-muted);border-radius:50%;width:25px;height:25px;line-height:23px;font-size:14px;color:var(--hs-muted)}
.hima-trace [data-state=done] .hima-station{background:var(--hs-good);border-color:var(--hs-good);color:var(--hs-bg)}
.hima-trace [data-state=running] .hima-station{border:2px solid var(--hs-live);color:var(--hs-live);animation:hima-station-pulse 1.8s ease-in-out infinite}
.hima-trace [data-state=blocked] .hima-station{border-radius:4px;border-color:var(--hs-bad);color:var(--hs-bad)}
.hima-trace strong{font-size:12px;font-weight:600;overflow-wrap:anywhere;margin-top:5px}
.hima-trace li>span:not(.hima-station),.hima-trace small{font-size:11px;color:var(--hs-muted)}
.hima-trace-caption{display:flex;gap:12px;flex-wrap:wrap;padding:8px 0 2px;font-size:11px;color:var(--hs-muted)}
.hima-small{font-size:12px;color:var(--hs-muted);line-height:1.5}
.hima-activity{margin:0 12px 12px;background:var(--hs-raw);color:var(--hs-raw-ink);border-radius:6px;display:flex;flex-direction:column;flex:1;min-height:170px;overflow:hidden}
.hima-activity header,.hima-activity footer{display:flex;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid #34312b;font-size:11px;color:#aaa397}
.hima-activity header span:first-child{color:var(--hs-raw-ink);font-weight:600}
.hima-activity pre{margin:0;padding:12px;overflow:auto;flex:1;font:12px/1.65 'SF Mono',ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--hs-raw-ink)}
.hima-activity footer{border-bottom:0;border-top:1px solid #34312b;font-size:11px}
.hima-studio-footer{flex:none;display:flex;align-items:center;gap:12px;padding:7px 14px;border-top:1px solid var(--hs-line);font-size:11px;color:var(--hs-muted)}
.hima-studio-footer>span:nth-child(2){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hima-studio-footer>span:first-child,.hima-studio-footer>span:last-child{white-space:nowrap}
.hima-detail{padding:18px;display:flex;flex-direction:column;gap:14px;min-width:0}
.hima-detail h3{font-size:17px;font-weight:600}
.hima-detail table{font-size:13px;min-width:560px}
.hima-evidence>div{padding:10px 0;border-bottom:1px solid var(--hs-line)}
.hima-detail pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.hima-detail details summary{font-size:13px;cursor:pointer}
.hima-detail a{color:var(--hs-accent)}
.hima-report{line-height:1.65}
.hima-empty{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;gap:14px;padding:40px 28px;color:var(--hs-muted)}
.hima-empty h3{font-size:20px;font-weight:550;color:var(--hs-ink);letter-spacing:-.02em}
.hima-empty p{max-width:340px;font-size:13px}
.hima-empty-glyph{font-size:32px;color:var(--hs-accent)}
.hima-notice{padding:10px 14px;font-size:12px;color:var(--hs-bad);background:var(--hs-soft);overflow-wrap:anywhere}
.hima-start-form{padding:18px;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:16px}
.hima-start-form h4{font-size:13px;font-weight:600;border-top:1px solid var(--hs-line);padding-top:12px}
.hima-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.hima-fields label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:500;min-width:0}
.hima-fields input,.hima-fields select{border:1px solid var(--hs-line);border-radius:5px;background:var(--hs-bg);color:var(--hs-ink);padding:8px;min-width:0;width:100%;font-size:13px}
.hima-fields small{font-size:11px;font-weight:400;color:var(--hs-muted)}
.hima-preflight{font-size:12px;color:var(--hs-muted)}
.hima-preflight[data-hima-state-status=fit]{color:var(--hs-good)}
.hima-start-footer{display:flex;flex-direction:column;align-items:flex-start;gap:14px}
.hima-start-footer details{font-size:11px;color:var(--hs-muted)}
.hima-start-footer summary{cursor:pointer}
.hima-entry button{display:flex;align-items:center;gap:10px;width:100%;min-height:36px;border:0;border-radius:6px;padding:6px 12px;background:transparent;color:var(--hs-ink);font-size:14px;cursor:pointer}
.hima-entry button:hover{background:var(--hs-soft)}
.hima-entry[data-wide=false] button{justify-content:center;padding:6px}
.hima-entry p{padding:4px 10px;font-size:11px;color:var(--hs-muted);margin:0}
.hima-brand{display:flex;align-items:center;gap:8px;font-size:17px;letter-spacing:-.04em;font-weight:650}
@keyframes hima-station-pulse{50%{opacity:.5}}
@media(prefers-reduced-motion:reduce){.hima-trace [data-state=running] .hima-station{animation:none}}
.hima-studio[data-stale=true] .hima-station{animation:none}
`;
