// One drawing shared by navigation, wordmark and native app icons. Urbanist 500:
// 2000 units/em, i stem 167.998046875 units, i ink height 1345.4241333007812.
// Ink height = 21 on a 24-unit grid. Stroke t equals the font's vertical stem;
// the central white diamond has horizontal/vertical diagonals 2t. No size variants.
export const AIX_SYMBOL_STROKE = 21 * 167.998046875 / 1345.4241333007812;
const diagonal = Math.SQRT1_2;
const inner = AIX_SYMBOL_STROKE * diagonal;
const outer = 21 * diagonal - AIX_SYMBOL_STROKE / 2;
const directions = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const;
export const AIX_SYMBOL_POLYGONS = directions.map(([sx, sy]) => {
  const ux = sx * diagonal, uy = sy * diagonal;
  const point = (radius: number, side: number) => [
    12 + ux * radius - uy * side,
    12 + uy * radius + ux * side,
  ];
  const half = AIX_SYMBOL_STROKE / 2;
  return [point(inner, -half), point(outer, -half), point(outer, half), point(inner, half)];
});
