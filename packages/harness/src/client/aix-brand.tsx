import type { ReactElement } from 'react';
import { AIX_SYMBOL_POLYGONS } from './aix-symbol.js';
import { EMPYREAN_LOGO_URL } from './empyrean-logo.js';

export const AIX_NAME = 'Empyrean aiX Harness';
export const AIX_TAGLINE = 'Orchestrating the Extraordinary.';

/** Compact navigation symbol: the same four-part X as the app icon and campaign artwork. */
export function AiXSymbol({ size = 24, className }: { size?: number; className?: string }): ReactElement {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={['aix-symbol', className].filter(Boolean).join(' ')} fill="currentColor">
    {AIX_SYMBOL_POLYGONS.map((polygon, index) => <polygon key={index} points={polygon.map(point => point.join(',')).join(' ')} />)}
  </svg>;
}

/** Licensed Urbanist 500 letters paired with the same X used in the navigation. */
export function AiXWordmark({ label = 'aiX' }: { label?: string }): ReactElement {
  return <span className="aix-wordmark" role="img" aria-label={label}>
    <span aria-hidden="true">ai</span><AiXSymbol />
  </span>;
}

export function AiXName(): ReactElement {
  return <span className="hima-brand"><span className="empyrean-wordmark"><img src={EMPYREAN_LOGO_URL} alt="Empyrean" width={490} height={203} /></span><span className="aix-brand-product"><AiXWordmark /><span className="aix-brand-suffix">Harness</span></span></span>;
}

export function AiXTagline(): ReactElement {
  return <span className="aix-tagline" aria-label={AIX_TAGLINE}>
    <span aria-hidden="true">Orch<strong>e</strong>str<strong>a</strong>t<strong>i</strong>ng the E<strong>x</strong>traordinary.</span>
  </span>;
}

/** The existing brand seat supplies the complete product lockup on the blank-session surface. */
export function AiXHeroBrand(): ReactElement {
  return <span className="aix-hero-brand">
    <AiXWordmark label={AIX_NAME} />
    <AiXTagline />
    <span className="aix-hero-description">Expertise, composed around your engineering goals.</span>
  </span>;
}
