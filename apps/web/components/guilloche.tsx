/** Guilloché: layered hypotrochoids, the anti-counterfeit linework of cheques and banknotes. Rendered on the server. */
export function Guilloche(props: { cx: number; cy: number; R: number; r: number; d: number; layers: number; color: string; width: number; viewBox: string; className?: string }) {
  const { cx, cy, R, r, d, layers } = props;
  const paths: string[] = [];
  for (let k = 0; k < layers; k++) {
    let p = '';
    const dk = d + k * 3.2;
    for (let t = 0; t <= Math.PI * 2 * r; t += 0.03) {
      const x = cx + (R - r) * Math.cos(t) + dk * Math.cos(((R - r) / r) * t);
      const y = cy + (R - r) * Math.sin(t) - dk * Math.sin(((R - r) / r) * t);
      p += (p ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    paths.push(p);
  }
  return (
    <svg className={props.className} viewBox={props.viewBox} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {paths.map((p, i) => (
        <path key={i} d={p} fill="none" stroke={props.color} strokeWidth={props.width} />
      ))}
    </svg>
  );
}
