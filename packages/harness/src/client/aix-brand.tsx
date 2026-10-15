import type { ReactElement } from 'react';

export const AIX_NAME = 'Empyrean aiX Harness';
export const AIX_TAGLINE = 'Orchestrating the Extraordinary.';

/** Compact navigation symbol: the same four-part X as the app icon and campaign artwork. */
export function AiXSymbol({ size = 24, className }: { size?: number; className?: string }): ReactElement {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
    <path d="M3 1.5 10.2 8.7 8.7 10.2 1.5 3ZM14 8.5 21 1.5 22.5 3 15.5 10Z" />
    <path d="M1.5 21 8.7 13.8 10.2 15.3 3 22.5ZM13.8 15.3 15.3 13.8 22.5 21 21 22.5Z" />
  </svg>;
}

/** Font-independent aiX wordmark. Coordinates match the geometric brand master. */
export function AiXWordmark(): ReactElement {
  return <svg viewBox="150 350 710 370" className="aix-wordmark" aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round">
    <circle cx="284" cy="574" r="94" strokeWidth="54" />
    <path d="M369 480V668M471 508V668" strokeWidth="54" />
    <circle cx="471" cy="426" r="29" fill="currentColor" stroke="none" />
    <path d="M574 426 660 523M708 577 794 674M574 674 660 577M708 523 794 426" strokeWidth="60" />
  </svg>;
}

export function AiXName(): ReactElement {
  return <span className="hima-brand"><span className="aix-brand-parent">Empyrean</span><span className="aix-brand-product">aiX <span>Harness</span></span></span>;
}

export function AiXTagline(): ReactElement {
  return <span className="aix-tagline" aria-label={AIX_TAGLINE}>
    <span aria-hidden="true">Orch<strong>e</strong>str<strong>a</strong>t<strong>i</strong>ng the E<strong>x</strong>traordinary.</span>
  </span>;
}

/** The existing brand seat supplies the complete product lockup on the blank-session surface. */
export function AiXHeroBrand(): ReactElement {
  return <span className="aix-hero-brand">
    <span className="aix-hero-wordmark" aria-label={AIX_NAME}><AiXWordmark /></span>
    <AiXTagline />
    <span className="aix-hero-description">Expertise, composed around your engineering goals.</span>
  </span>;
}
