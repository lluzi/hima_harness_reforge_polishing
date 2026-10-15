import { AIX_FONT_URL } from './aix-font.js';

// Presentation only. Native ui-theme continues to own preference, color-scheme and font size.
// The class is attached and removed by the existing client adapter's lifecycle.
export const AIX_STYLE = `
@font-face{font-family:"aiX Manrope";src:url("${AIX_FONT_URL}") format("woff2");font-style:normal;font-weight:200 800;font-display:swap}
body.aix-shell{
  --hima-fs-display:28px;--hima-fs-title:18px;--hima-fs-body:14px;--hima-fs-label:13px;--hima-fs-eyebrow:12px;--hima-sp-2:8px;--hima-sp-4:16px;
  --aix-font-ui:"aiX Manrope",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --aix-paper:#ffffff;--aix-soft:#f4f7fb;--aix-panel:#edf2f8;--aix-border:#d9e2ee;--aix-border-strong:#b8c8dc;
  --aix-ink:#122b4a;--aix-muted:#506580;--aix-caption:#627791;--aix-brand:#082f68;--aix-brand-hover:#164681;--aix-brand-soft:#e7effa;--aix-on-brand:#ffffff;
  --aix-action:#082f68;--aix-action-hover:#164681;
  --aix-success:#24754d;--aix-warning:#916109;--aix-error:#b13c45;--aix-code:#091a31;--aix-code-ink:#d9e6f5;
  --dsw-font-family:var(--aix-font-ui);
  --dsw-alias-bg-base:var(--aix-paper);--dsw-alias-bg-layer-1:var(--aix-paper);--dsw-alias-bg-layer-2:var(--aix-soft);--dsw-alias-bg-layer-3:var(--aix-paper);
  --dsw-alias-bg-module-platform:var(--aix-panel);
  --dsw-alias-border-l1:var(--aix-soft);--dsw-alias-border-l2:var(--aix-border);--dsw-alias-border-l3:var(--aix-border);--dsw-alias-border-l4:var(--aix-border-strong);
  --dsw-alias-label-primary:var(--aix-ink);--dsw-alias-label-primary-bluish:var(--aix-ink);--dsw-alias-label-secondary:var(--aix-muted);--dsw-alias-label-tertiary:var(--aix-caption);--dsw-alias-label-caption:var(--aix-caption);
  --dsw-alias-label-primary-inverted:var(--aix-on-brand);--dsw-alias-brand-primary:var(--aix-brand);--dsw-alias-brand-text:var(--aix-brand);--dsw-alias-brand-primary-new-colorprimary-new-color:var(--aix-brand);
  --dsw-alias-button-primary-fill:var(--aix-brand);--dsw-alias-button-primary-hover:var(--aix-brand-hover);--dsw-alias-button-contrast-fill:var(--aix-brand);--dsw-alias-button-primary-dimmed:var(--aix-brand-soft);
  --dsw-alias-button-info-fill:var(--aix-action);--dsw-alias-button-info-hover:var(--aix-action-hover);
  --dsw-alias-button-elevated-fill:var(--aix-paper);--dsw-alias-button-floating-fill:var(--aix-paper);--dsw-alias-button-floating-hover:var(--aix-soft);--dsw-alias-button-tool-bar-hover:var(--aix-panel);
  --dsw-alias-interactive-bg-active:var(--aix-brand-soft);--dsw-alias-interactive-bg-hover:var(--aix-soft);--dsw-alias-interactive-bg-hover-accent:var(--aix-brand-soft);--dsw-alias-link:var(--aix-brand);
  --dsw-specific-sidebar-fill:var(--aix-soft);--dsw-specific-sidebar-nav-item-active:var(--aix-brand-soft);--dsw-specific-sidebar-nav-item-active-accent:var(--aix-brand-soft);--dsw-specific-sidebar-nav-item-hover:var(--aix-panel);
  --dsw-specific-menu:var(--aix-paper);--dsw-specific-selector:var(--aix-soft);
  --dsw-specific-input-major:var(--aix-panel);--dsw-specific-login-input:var(--aix-soft);--dsw-specific-bubble:var(--aix-soft);--dsw-specific-bubble-highlight:var(--aix-brand-soft);--dsw-specific-tip:var(--aix-soft);
  --dsw-alias-state-success-primary:var(--aix-success);--dsw-alias-state-warn-primary:var(--aix-warning);--dsw-alias-state-error-primary:var(--aix-error);
  --dsw-alias-markdown-code-block:var(--aix-soft);--dsw-alias-markdown-code-block-banner:var(--aix-panel);--dsw-alias-markdown-inline-code:var(--aix-panel);
  font-family:var(--aix-font-ui);background:var(--aix-paper);color:var(--aix-ink);accent-color:var(--aix-brand);
}
body.aix-shell[data-ds-dark-theme]{
  --aix-paper:#101d30;--aix-soft:#0a1729;--aix-panel:#192b43;--aix-border:#293d57;--aix-border-strong:#446181;
  --aix-ink:#edf3fb;--aix-muted:#b1c2d8;--aix-caption:#8fa5c0;--aix-brand:#b6cef0;--aix-brand-hover:#d2e2fa;--aix-brand-soft:#203d60;--aix-on-brand:#082044;
  --aix-action:#2b5ea8;--aix-action-hover:#3e70b5;
  --aix-success:#8ccea9;--aix-warning:#e4bd73;--aix-error:#f0a0a8;--aix-code:#071322;--aix-code-ink:#d9e6f5;
}
.aix-shell ::selection{background:var(--aix-brand-soft);color:var(--aix-ink)}
.aix-shell :focus-visible{outline-color:var(--aix-brand)}
.aix-brand-parent{font-size:var(--hima-fs-eyebrow);font-weight:500;letter-spacing:.08em;color:var(--aix-muted)}
.aix-brand-product{font-weight:700;letter-spacing:-.035em;color:var(--aix-brand)}
.aix-brand-product>span{font-weight:500;letter-spacing:-.025em;color:var(--aix-ink)}
.aix-wordmark{display:block;width:104px;height:56px;max-width:100%;color:var(--aix-brand)}
.aix-hero-brand{display:flex;flex-direction:column;align-items:flex-start;gap:var(--hima-sp-4);min-width:0;max-width:100%;padding:var(--hima-sp-2) 0;color:var(--aix-ink);font-family:var(--aix-font-ui)}
.aix-hero-description{font-size:var(--hima-fs-label);font-weight:400;line-height:1.6;color:var(--aix-muted);letter-spacing:0}
.aix-tagline{display:block;font-size:var(--hima-fs-display);font-weight:400;line-height:1.3;letter-spacing:-.04em;color:var(--aix-muted);white-space:normal;text-wrap:balance}
.aix-tagline strong{color:var(--aix-brand);font-weight:700}
/* The pinned shell has a brand seat followed by its generic headline. The branded lockup
   owns that headline visually; workspace, preset and composer seats remain the shell's. */
.aix-shell span:has(>[data-slot="conversation.hero.brand.mark"]){display:contents}
.aix-shell span:has(>[data-slot="conversation.hero.brand.mark"])+span{display:none}
.aix-shell div:has(>span>[data-slot="conversation.hero.brand.mark"]){display:block;min-width:0;width:100%}
@media (prefers-reduced-motion:reduce){.aix-shell *{scroll-behavior:auto}}
`;
