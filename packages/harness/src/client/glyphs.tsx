// Hima's icon set: inline SVG only, never a unicode character standing in for a shape or an
// imported icon font. Every glyph is drawn on the same 16x16 grid so a caller can drop one beside
// text without measuring it, and every glyph inherits its colour from `currentColor` so it follows
// the token sheet's state colours without a second palette of icon fills.
import type { ReactElement } from 'react';

export type GlyphName =
  | 'check' | 'dot' | 'ring' | 'hourglass' | 'retry' | 'square' | 'bar' | 'diamond'
  | 'circle' | 'octagon' | 'locate' | 'zoom-in' | 'zoom-out' | 'close' | 'arrow-right' | 'warning';

/** The three glyphs drawn as a solid shape rather than an outlined stroke. */
const FILLED = new Set<GlyphName>(['check', 'dot', 'square']);

function GlyphShape({ name }: { name: GlyphName }): ReactElement {
  switch (name) {
    case 'check':
      return <path d="M6.4 12.2 2.8 8.6 4.2 7.2 6.4 9.4 11.8 4 13.2 5.4Z" />;
    case 'dot':
      return <circle cx="8" cy="8" r="3.4" />;
    case 'square':
      return <rect x="5" y="5" width="6" height="6" />;
    case 'ring':
      return <circle cx="8" cy="8" r="5" strokeWidth={3} />;
    case 'hourglass':
      return <path d="M4 2h8M4 14h8M5 2c0 4 6 4 6 8M11 2c0 4-6 4-6 8" strokeWidth={1.4} strokeLinecap="round" />;
    case 'retry':
      return <path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v3h-3" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />;
    case 'bar':
      return <rect x="2" y="7" width="12" height="2" rx="1" />;
    case 'diamond':
      return <path d="M8 3 13 8 8 13 3 8Z" strokeWidth={1.4} strokeLinejoin="round" />;
    case 'circle':
      return <circle cx="8" cy="8" r="5" strokeWidth={1.4} />;
    case 'octagon':
      return <path d="M5.5 2h5L14 5.5v5L10.5 14h-5L2 10.5v-5Z" strokeWidth={1.4} strokeLinejoin="round" />;
    case 'locate':
      return (
        <>
          <circle cx="8" cy="8" r="2" strokeWidth={1.4} />
          <path d="M8 1v2.4M8 12.6V15M1 8h2.4M12.6 8H15" strokeWidth={1.4} strokeLinecap="round" />
        </>
      );
    case 'zoom-in':
      return (
        <>
          <circle cx="7" cy="7" r="4.5" strokeWidth={1.4} />
          <path d="M10.3 10.3 14 14M7 4.7v4.6M4.7 7h4.6" strokeWidth={1.4} strokeLinecap="round" />
        </>
      );
    case 'zoom-out':
      return (
        <>
          <circle cx="7" cy="7" r="4.5" strokeWidth={1.4} />
          <path d="M10.3 10.3 14 14M4.7 7h4.6" strokeWidth={1.4} strokeLinecap="round" />
        </>
      );
    case 'close':
      return <path d="M4 4 12 12M12 4 4 12" strokeWidth={1.4} strokeLinecap="round" />;
    case 'arrow-right':
      return <path d="M2.5 8h9M8.3 4.3 12 8l-3.7 3.7" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" />;
    case 'warning':
      return (
        <>
          <path d="M8 2.4 14.4 13.6H1.6Z" strokeWidth={1.3} strokeLinejoin="round" />
          <path d="M8 6.4v3.6" strokeWidth={1.3} strokeLinecap="round" />
          <circle cx="8" cy="11.6" r="0.9" fill="currentColor" stroke="none" />
        </>
      );
  }
}

/** One glyph, drawn as inline SVG on a 16x16 grid. Never a unicode character, never an icon font. */
export function Glyph({ name, size = 16, className }: { name: GlyphName; size?: number; className?: string }): ReactElement {
  const filled = FILLED.has(name);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className={className}
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}>
      <GlyphShape name={name} />
    </svg>
  );
}
