// Parser for SAM 3.1 special-token output.
// Example: <0f>0<|box;x1=20;y1=20;x2=180;y2=120;w=400;h=300|><|mask;x=0;y=0;data=...|>
export type Det = { x1: number; y1: number; x2: number; y2: number; w: number; h: number; hasMask: boolean };
export function parseSam(text: string): Det[] {
  const out: Det[] = [];
  const re = /<\|box;([^|]*)\|>(<\|mask;)?/g;
  let m;
  while ((m = re.exec(text))) {
    const kv: Record<string, number> = {};
    for (const p of m[1].split(";")) { const [k, v] = p.split("="); kv[k] = Number(v); }
    if ([kv.x1, kv.y1, kv.x2, kv.y2].some((v) => Number.isNaN(v))) continue;
    out.push({ x1: kv.x1, y1: kv.y1, x2: kv.x2, y2: kv.y2, w: kv.w, h: kv.h, hasMask: !!m[2] });
  }
  return out;
}
