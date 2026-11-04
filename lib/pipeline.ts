import { chat, image, ledger, RUN_CAP_USD, sam } from "./meta.ts";
import { type Det, parseSam } from "./sam.ts";
import { scaffold, slugify } from "./inspatial.ts";

export type Field = { key: string; label: string; type: string; required: boolean; choices: string[] };
export type Intent = {
  app_name: string; kind: string; summary: string;
  theme: { primary: string; background: string; style: string };
  entities: { name: string; fields: Field[] }[];
  screens: { name: string; purpose: string; components: string[] }[];
  actions: { name: string; description: string }[];
  seed: { entity: string; rows: { key: string; value: string }[][] }[];
};
export type Ev = { step: string; status: "start" | "done" | "error" | "info"; model?: string; ms?: number; cost?: number; data?: any; msg?: string; t: number };
const SPARK = "muse-spark-1.3", WONDER = "muse-wonder-1.0";

const s = (schema: any) => schema;
const str = { type: "string" }, arrStr = { type: "array", items: str };
const INTENT_SCHEMA = s({
  type: "object", additionalProperties: false,
  required: ["app_name", "kind", "summary", "theme", "entities", "screens", "actions", "seed"],
  properties: {
    app_name: str, kind: { type: "string", enum: ["ui_sketch", "shelf_photo", "paper_form"] }, summary: str,
    theme: { type: "object", additionalProperties: false, required: ["primary", "background", "style"], properties: { primary: str, background: str, style: str } },
    entities: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "fields"], properties: { name: str, fields: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "label", "type", "required", "choices"], properties: { key: str, label: str, type: { type: "string", enum: ["text", "number", "money", "boolean", "date", "email", "phone", "choice", "image"] }, required: { type: "boolean" }, choices: arrStr } } } } } },
    screens: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "purpose", "components"], properties: { name: str, purpose: str, components: arrStr } } },
    actions: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "description"], properties: { name: str, description: str } } },
    seed: { type: "array", items: { type: "object", additionalProperties: false, required: ["entity", "rows"], properties: { entity: str, rows: { type: "array", items: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "value"], properties: { key: str, value: str } } } } } } },
  },
});
const js = (name: string, schema: any) => ({ type: "json_schema", json_schema: { name, strict: true, schema } });
const img = (url: string) => ({ type: "image_url", image_url: { url } });

export class Run {
  id: string; dir: string; events: Ev[] = []; listeners = new Set<(e: Ev) => void>();
  cost = 0; t0 = Date.now(); state: any = {}; done = false;
  constructor(public imageDataUrl: string, public opts: { injectFault?: boolean; label?: string }) {
    this.id = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 6);
    this.dir = `./runs/${this.id}`;
    Deno.mkdirSync(this.dir, { recursive: true });
  }
  emit(e: Omit<Ev, "t">) {
    const ev = { ...e, t: Date.now() - this.t0 } as Ev;
    if (ev.cost) this.cost += ev.cost;
    this.events.push(ev);
    for (const l of this.listeners) l(ev);
    Deno.writeTextFileSync(`${this.dir}/events.json`, JSON.stringify(this.events, null, 1));
  }
  capCheck() { if (this.cost > RUN_CAP_USD) throw new Error(`Per-run cost cap $${RUN_CAP_USD} hit`); }

  async step<T>(step: string, model: string | undefined, fn: () => Promise<{ value: T; cost: number; data?: any }>): Promise<T> {
    this.capCheck();
    this.emit({ step, status: "start", model });
    const t = performance.now();
    try {
      const r = await fn();
      this.emit({ step, status: "done", model, ms: performance.now() - t, cost: r.cost, data: r.data });
      return r.value;
    } catch (e) {
      this.emit({ step, status: "error", model, ms: performance.now() - t, msg: String(e).slice(0, 400) });
      throw e;
    }
  }

  async go() {
    try {
      // 1. Scout: what is this + SAM noun phrases
      const scout = await this.step("Scout input", SPARK, async () => {
        const r = await chat(SPARK, [{ role: "user", content: [
          { type: "text", text: "Classify this input as ui_sketch (drawn app screen), shelf_photo (physical items to inventory) or paper_form. Then give 2-4 short, concrete noun phrases that SAM 3.1 should segment: for a ui_sketch use simple visual nouns SAM can see, like 'rounded rectangle', 'plus sign in a square', 'small picture icon', 'handwritten word'; for a shelf use each product type (e.g. 'glass jar of coffee beans'); for a form use 'handwritten text field', 'checkbox'." },
          img(this.imageDataUrl)] }], { reasoning_effort: "low", max_tokens: 4000, response_format: js("scout", { type: "object", additionalProperties: false, required: ["kind", "prompts"], properties: { kind: { type: "string", enum: ["ui_sketch", "shelf_photo", "paper_form"] }, prompts: arrStr } }) });
        const v = JSON.parse(r.text); v.prompts = v.prompts.slice(0, 4);
        return { value: v, cost: r.cost, data: v };
      });
      this.state.scout = scout;

      // 2. SAM 3.1 segmentation per noun phrase (parallel, streamed)
      const segs = await this.step("SAM 3.1 segmentation", "sam-3.1", async () => {
        const res = await Promise.all(scout.prompts.map(async (p: string) => {
          try {
            const r = await sam(p, this.imageDataUrl);
            let dets = parseSam(r.text), cost = r.cost, ms = r.ms, prompt = p;
            const simpler = p.split(/ of | with /)[0].trim();
            if (!dets.length && simpler !== p) { // retry once with a simpler noun phrase
              const r2 = await sam(simpler, this.imageDataUrl); cost += r2.cost; ms += r2.ms;
              const d2 = parseSam(r2.text); if (d2.length) { dets = d2; prompt = `${p} → ${simpler}`; }
            }
            return { prompt, dets, cost, ms };
          }
          catch (e) { return { prompt: p, dets: [] as Det[], cost: 0, ms: 0, error: String(e).slice(0, 200) }; }
        }));
        const cost = res.reduce((a, b) => a + b.cost, 0);
        return { value: res, cost, data: { segments: res.map((r) => ({ prompt: r.prompt, count: r.dets.length, dets: r.dets, ms: Math.round(r.ms), error: (r as any).error })) } };
      });
      this.state.segments = segs;
      const counts = segs.map((x) => `${x.prompt}: ${x.dets.length} instance(s)`).join("; ");

      // 3. App Intent (structured output)
      const intent: Intent = await this.step("App Intent JSON", SPARK, async () => {
        const r = await chat(SPARK, [
          { role: "system", content: "You are Genesis Pro Builder's planner. Turn a photo of a napkin UI sketch, a shelf, or a paper form into a precise App Intent for a small, data-backed mobile app. Read all visible text exactly. Use SAM 3.1 counts as the source for quantities (e.g. stock levels), but if a SAM count is 0 or clearly contradicts what you can see, use your own careful visual count instead. For a shelf photo plan an inventory+ordering app where ordering decrements stock. For a paper form plan a sign-up app whose fields match the form, and seed it with the handwritten entry exactly as written (it is the first member record). For a UI sketch, mirror the drawn layout and items; include an Order entity if there is an order button. Keep it to 1-3 entities, 1-3 screens, 1-3 actions. theme colours are hex." },
          { role: "user", content: [{ type: "text", text: `Input kind (scout): ${scout.kind}. SAM 3.1 detections: ${counts}.` }, img(this.imageDataUrl)] },
        ], { reasoning_effort: "low", max_tokens: 12000, response_format: js("app_intent", INTENT_SCHEMA) });
        const v = JSON.parse(r.text);
        return { value: v, cost: r.cost, data: v };
      });
      this.state.intent = intent;
      const slug = slugify(intent.app_name);
      this.state.slug = slug;

      // 4. InSpatial project (CLI scaffold + generated Cloud schema / ISS styles)
      await this.step("InSpatial project (inspatial create + Cloud schema + style.ts)", "inspatial CLI", async () => {
        const r = await scaffold(`${this.dir}/inspatial`, slug, intent, { imageDataUrl: this.imageDataUrl, segs });
        return { value: r, cost: 0, data: { ok: r.ok, files: r.files, log: r.log.slice(-600), preview: r.preview } };
      }).catch(() => null);

      // 5. Live preview app code (Spark), run-check, repair with Wonder
      let html = await this.step("Generate app code", SPARK, async () => {
        const r = await chat(SPARK, [
          { role: "system", content: "You write production-quality single-file mobile web apps. Output ONLY a complete HTML document (no markdown fences). Inline CSS and JS only; no external URLs, fonts, images or CDNs (use emoji or CSS shapes for images). Mobile-first for a 390px wide phone. Persist data in localStorage under key 'gpb-data' and seed it from the provided seed data on first load. Every action in the intent must work (e.g. adding to an order and placing it decrements stock and shows a confirmation; a sign-up form validates and appends a member to a visible list). Use <button> elements for actions. The first screen must visibly show the seed records (e.g. menu items, stock list, or the existing members list with the seeded member's details) and every text label read from the input. Polished, modern UI using the theme colours. Keep it under 350 lines." },
          { role: "user", content: [{ type: "text", text: "App Intent JSON:\n" + JSON.stringify(intent) }, img(this.imageDataUrl)] },
        ], { reasoning_effort: "low", max_tokens: 24000 });
        const h = stripFences(r.text);
        return { value: h, cost: r.cost, data: { bytes: h.length, tokens: r.usage?.completion_tokens } };
      });
      if (this.opts.injectFault) {
        html = html.replace(/<script>/, "<script>\nconst __gpb = ;  // injected fault (demo): syntax error\n");
        this.emit({ step: "Fault injection (demo toggle)", status: "info", msg: "Injected a syntax error into the generated code to exercise the repair loop" });
      }
      let check: any;
      for (let attempt = 0; attempt < 3; attempt++) {
        await Deno.writeTextFile(`${this.dir}/preview.html`, html);
        check = await this.step(attempt === 0 ? "Build + run check (headless)" : `Re-check after repair #${attempt}`, "playwright", async () => {
          const v = await runCheck(`${Deno.cwd()}/${this.dir.slice(2)}/preview.html`, `${this.dir}/preview.png`);
          return { value: v, cost: 0, data: v };
        });
        if (check.ok) break;
        html = await this.step(`Repair #${attempt + 1} (escalate to Muse Wonder)`, WONDER, async () => {
          const r = await chat(WONDER, [
            { role: "system", content: "You repair single-file HTML apps. Return ONLY the full corrected HTML document, no fences, no commentary. Keep all features." },
            { role: "user", content: `Headless run errors:\n${check.errors.join("\n") || "page rendered no usable UI/buttons"}\n\nHTML:\n${html}` },
          ], { max_tokens: 24000 });
          return { value: stripFences(r.text), cost: r.cost, data: { bytes: r.text.length } };
        });
      }
      this.state.check = check;
      this.state.previewOk = !!check?.ok;

      // 6. Fidelity (Spark judges input vs rendered screenshot)
      if (check?.ok) {
        const shot = "data:image/png;base64," + b64(await Deno.readFile(`${this.dir}/preview.png`));
        this.state.fidelity = await this.step("Fidelity score (input vs running app)", SPARK, async () => {
          const r = await chat(SPARK, [{ role: "user", content: [
            { type: "text", text: "Image 1 is the user's input (sketch/photo/form). Image 2 is a screenshot of the app generated from it. Score 0-100 how faithfully the app captures the input's content, structure and data (not visual polish). Be strict." },
            img(this.imageDataUrl), img(shot)] }], { reasoning_effort: "low", max_tokens: 4000, response_format: js("fidelity", { type: "object", additionalProperties: false, required: ["score", "reason"], properties: { score: { type: "integer" }, reason: str } }) });
          const v = JSON.parse(r.text);
          return { value: v, cost: r.cost, data: v };
        }).catch(() => null);
      }
      this.emit({ step: "Complete", status: "done", data: { ok: !!check?.ok, totalMs: Date.now() - this.t0, cost: this.cost, ledger: ledger().total } });
    } catch (e) {
      this.emit({ step: "Run failed", status: "error", msg: String(e).slice(0, 400) });
    } finally {
      this.done = true;
      Deno.writeTextFileSync(`${this.dir}/summary.json`, JSON.stringify({ id: this.id, label: this.opts.label, ok: !!this.state.previewOk, ms: Date.now() - this.t0, cost: this.cost, fidelity: this.state.fidelity?.score ?? null, repairs: this.events.filter((e) => e.step.startsWith("Repair") && e.status === "done").length, injectFault: !!this.opts.injectFault, kind: this.state.scout?.kind }, null, 2));
    }
  }

  async mock(prompt?: string) {
    const prev = this.state.mockId;
    const r = await this.step(prev ? `Muse Image edit: "${prompt}"` : "Muse Image hi-fi mock", "muse-image-1.0", async () => {
      const it = this.state.intent as Intent;
      const p = prev ? prompt! : `Render a polished, realistic hi-fi mobile app screenshot for "${it?.app_name}" based on this input. ${it?.summary ?? ""} Screens: ${(it?.screens ?? []).map((s) => s.name).join(", ")}. Clean modern UI, phone frame.`;
      const v = await image(p, prev ? undefined : this.imageDataUrl, prev);
      const n = (this.state.mockN = (this.state.mockN ?? 0) + 1);
      await Deno.writeFile(`${this.dir}/mock-${n}.jpg`, Uint8Array.from(atob(v.b64), (c) => c.charCodeAt(0)));
      this.state.mockId = v.id;
      return { value: n, cost: v.cost, data: { url: `/runs/${this.id}/mock-${n}.jpg` } };
    });
    return r;
  }
}

function stripFences(t: string) {
  const m = t.match(/```(?:html)?\s*([\s\S]*?)```/);
  const h = (m ? m[1] : t).trim();
  const i = h.search(/<!doctype|<html/i);
  return i > 0 ? h.slice(i) : h;
}
function b64(u: Uint8Array) { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); }
export { b64 };
async function runCheck(html: string, png: string) {
  const o = await new Deno.Command("python3", { args: ["tools/check_preview.py", html, png], stdout: "piped", stderr: "piped" }).output();
  const out = new TextDecoder().decode(o.stdout).trim().split("\n").pop() ?? "";
  try { return JSON.parse(out); } catch { return { ok: false, errors: ["checker crashed: " + new TextDecoder().decode(o.stderr).slice(-300)] }; }
}
