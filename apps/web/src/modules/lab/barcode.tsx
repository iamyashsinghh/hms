// Code 128 (set B) as inline SVG, for sample tube labels. No dependency; scanners read it as plain text.

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232',
  '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122',
  '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311',
  '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113',
  '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422',
  '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111',
  '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121',
  '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** Bar/space module widths for `text` (printable ASCII only). */
export function code128B(text: string): number[] {
  const codes = [START_B, ...[...text].map((c) => Math.min(Math.max(c.charCodeAt(0) - 32, 0), 94))];
  const check = codes.reduce((sum, c, i) => sum + c * (i === 0 ? 1 : i), 0) % 103;
  return [...codes, check, STOP].flatMap((c) => [...PATTERNS[c]!].map(Number));
}

export function Barcode({ value, height = 40, moduleWidth = 1.4, className }: { value: string; height?: number; moduleWidth?: number; className?: string }) {
  const widths = code128B(value);
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const bars: React.ReactNode[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push(<rect key={i} x={x} y={0} width={w} height={height} />);
    x += w;
  });
  return (
    <svg
      role="img"
      aria-label={`Barcode ${value}`}
      className={className}
      width={total * moduleWidth}
      height={height}
      viewBox={`0 0 ${total} ${height}`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
    >
      <rect width={total} height={height} fill="#fff" />
      <g fill="#000">{bars}</g>
    </svg>
  );
}
