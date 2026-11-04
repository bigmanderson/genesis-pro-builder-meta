// InSpatial Kit showcase UI for generated projects (Genesis Pro Builder).
// Fills lib/templates/kit-window.tsx.tpl + kit-style.ts.tpl from an App Intent: hero header from the input photo,
// image cards (SAM crops of the photo, see tools/inspatial_assets.py), stock bars with low-stock badges and
// +/- / Place order actions that write through the InSpatial Cloud entries API (createEntry / updateEntry).
import type { Intent } from "./pipeline.ts";

const camel = (s: string) => s.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toLowerCase());
const tpl = (f: string) => Deno.readTextFileSync(new URL(`./templates/${f}`, import.meta.url));
const hex = (v: string, d: string) => (/^#[0-9a-fA-F]{6}$/.test(v ?? "") ? v : d);
const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

export type KitPlan = { F: { entry: string; name: string; stock: string | null; unit: string | null }; O: { entry: string; product: string; qty: string | null; date: string | null } | null; seed: { name: string; detail: string; raw: Record<string, unknown> }[] };

export function kitPlan(intent: Intent): KitPlan {
  const ents = intent.entities;
  const main = ents.find((e) => e.fields.some((f) => f.type === "number")) ?? ents[0];
  const txt = main.fields.find((f) => ["text", "choice"].includes(f.type)) ?? main.fields[0];
  const num = main.fields.find((f) => f.type === "number") ?? null;
  const unit = main.fields.find((f) => /unit/i.test(f.key)) ?? null;
  const other = ents.find((e) => e !== main && e.fields.some((f) => f.type === "number"));
  const O = other ? { entry: camel(other.name), product: camel((other.fields.find((f) => f.type === "text") ?? other.fields[0]).key), qty: other.fields.find((f) => f.type === "number") ? camel(other.fields.find((f) => f.type === "number")!.key) : null, date: other.fields.find((f) => /date/i.test(f.key) || f.type === "date") ? camel(other.fields.find((f) => /date/i.test(f.key) || f.type === "date")!.key) : null } : null;
  const rows = intent.seed.find((s) => camel(s.entity) === camel(main.name))?.rows ?? [];
  const seed = rows.slice(0, 12).map((r) => {
    const raw: Record<string, unknown> = {};
    for (const kv of r) { const f = main.fields.find((x) => camel(x.key) === camel(kv.key)); raw[camel(kv.key)] = f?.type === "number" ? Number(kv.value) || 0 : String(kv.value); }
    const full = String(raw[camel(txt.key)] ?? "");
    const [name, ...rest] = full.split(/\s+-\s+/);
    const nice = name.split(/\s+/).map((w) => (/\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(" ");
    raw[camel(txt.key)] = nice;
    const extra = main.fields.filter((f) => f !== txt && f !== num && f !== unit && f.type !== "number").map((f) => String(raw[camel(f.key)] ?? "")).filter(Boolean);
    const detail = [rest.join(" - "), ...extra, unit && !rest.length ? String(raw[camel(unit.key)] ?? "") : ""].filter(Boolean).join(" · ");
    return { name: nice, detail: detail.replace(/^\w/, (c) => c.toUpperCase()), raw };
  });
  return { F: { entry: camel(main.name), name: camel(txt.key), stock: num ? camel(num.key) : null, unit: unit ? camel(unit.key) : null }, O, seed };
}

export function kitFiles(intent: Intent): Record<string, string> {
  const plan = kitPlan(intent);
  const max = Math.max(0, ...plan.seed.map((s) => Number(plan.F.stock ? s.raw[plan.F.stock] : 0)));
  const PAR = Math.max(12, Math.ceil((max * 1.25) / 2) * 2);
  const LOW = Math.max(1, Math.round(PAR / 3));
  const shelf = intent.kind === "shelf_photo";
  const order = intent.actions[0]?.name?.replace(/[{}<>`$]/g, "") || "Place order";
  const TEXT = {
    eyebrow: shelf ? "Built from one shelf photo · SAM 3.1 counted · Muse read" : intent.kind === "paper_form" ? "Built from one paper form · SAM 3.1 · Muse" : "Built from one sketch · SAM 3.1 · Muse",
    title: intent.app_name, subtitle: intent.summary,
    section: shelf ? "On the shelf" : intent.entities[0]?.name ?? "Items",
    items: shelf ? "products" : "items", units: shelf ? "units on shelf" : "in stock", low: "running low",
    lowBadge: "Low stock", okBadge: "In stock", orderLow: order, orderOk: "Top up", ordered: "Ordered", count: `${plan.seed.length} records in InSpatial Cloud`,
  };
  const cfg = `const SEED = ${JSON.stringify(plan.seed, null, 2)};\nconst F = ${JSON.stringify(plan.F)} as const;\nconst O = ${JSON.stringify(plan.O)} as { entry: string; product: string; qty: string | null; date: string | null } | null;\nconst TEXT = ${JSON.stringify(TEXT, null, 2)};\nconst PAR = ${PAR};\nconst LOW = ${LOW};`;
  const bg = hex(intent.theme.background, "#F7F2EA");
  const window = tpl("kit-window.tsx.tpl").replace("/*@CONFIG@*/", cfg).replace("/*@SCREENS@*/", intent.screens.map((s) => s.name).join(" · ").replace(/\*\//g, ""));
  const style = tpl("kit-style.ts.tpl").replace("/*@THEME@*/", intent.theme.style.replace(/\*\//g, "")).replace("/*@BG@*/", lum(bg) > 0.8 ? bg : "#F7F2EA").replace("/*@PRIMARY@*/", hex(intent.theme.primary, "#8A5A3B"));
  // Default art map (overwritten by tools/inspatial_assets.py when the input photo / SAM boxes are available).
  const art = `// Item art for the entry window: crops of the input photo from SAM 3.1 boxes (generated).\nexport const ShelfArt: Record<string, string> = { __hero: "/asset/hero.jpg" };\n`;
  return { "client/src/app/entry/window.tsx": window, "client/src/app/entry/style.ts": style, "client/src/app/entry/art.ts": art };
}
