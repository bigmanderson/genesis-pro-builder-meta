// Meta Model API client with cost ledger + hard cap. Key is read server-side only.
const BASE = Deno.env.get("META_BASE_URL") ?? "https://api.meta.ai/v1";
const KEY = () => {
  const k = Deno.env.get("MODEL_API_KEY");
  if (!k) throw new Error("MODEL_API_KEY not set");
  return k;
};
export const COST_CAP_USD = Number(Deno.env.get("COST_CAP_USD") ?? "15");
export const RUN_CAP_USD = Number(Deno.env.get("RUN_CAP_USD") ?? "1.00");
const LEDGER = "./data/ledger.json";

// Prices per docs (USD). Never use -contributor models.
export const PRICES: Record<string, { in?: number; out?: number; cached?: number; perImage?: number }> = {
  "muse-spark-1.3": { in: 1.25e-6, out: 4.25e-6, cached: 0.15e-6 },
  "muse-wonder-1.0": { in: 4e-6, out: 20e-6, cached: 0.2e-6 },
  "sam-3.1": { perImage: 0.0025 },
  "muse-image-1.0": { perImage: 0.01 },
};

type Ledger = { total: number; calls: number; byModel: Record<string, number> };
function readLedger(): Ledger {
  try { return JSON.parse(Deno.readTextFileSync(LEDGER)); } catch { return { total: 0, calls: 0, byModel: {} }; }
}
export function ledger() { return readLedger(); }
function charge(model: string, usd: number) {
  const l = readLedger();
  l.total += usd; l.calls++; l.byModel[model] = (l.byModel[model] ?? 0) + usd;
  Deno.writeTextFileSync(LEDGER, JSON.stringify(l, null, 2));
}
function guard(model: string) {
  if (model.includes("contributor")) throw new Error("contributor models are forbidden (IP rule)");
  if (readLedger().total >= COST_CAP_USD) throw new Error(`Global cost cap $${COST_CAP_USD} reached`);
}
export function tokenCost(model: string, u: any): number {
  const p = PRICES[model]; if (!u || !p) return 0;
  const inTok = u.prompt_tokens ?? u.input_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.input_tokens_details?.cached_tokens ?? 0;
  const outTok = u.completion_tokens ?? u.output_tokens ?? 0;
  return (inTok - cached) * (p.in ?? 0) + cached * (p.cached ?? 0) + outTok * (p.out ?? 0);
}

async function post(path: string, body: unknown, stream = false): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(BASE + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if ((r.status === 429 || r.status >= 500) && attempt < 4) {
      const ra = Number(r.headers.get("retry-after") ?? "0");
      await r.body?.cancel();
      await new Promise((res) => setTimeout(res, ra > 0 ? ra * 1000 : (2 ** attempt) * 800 + Math.random() * 400));
      continue;
    }
    if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r;
  }
}

export type CallResult = { text: string; usage: any; cost: number; ms: number; model: string; raw?: any };

export async function chat(model: string, messages: unknown[], opts: Record<string, unknown> = {}): Promise<CallResult> {
  guard(model);
  const t = performance.now();
  const r = await post("/chat/completions", { model, messages, max_tokens: 8000, ...opts });
  const d = await r.json();
  const cost = tokenCost(model, d.usage);
  charge(model, cost);
  return { text: d.choices?.[0]?.message?.content ?? "", usage: d.usage, cost, ms: performance.now() - t, model };
}

// SAM 3.1: streamed /v1/responses; returns concatenated output text (special tokens).
export async function sam(prompt: string, imageDataUrl: string): Promise<CallResult> {
  const model = "sam-3.1"; guard(model);
  const t = performance.now();
  const r = await post("/responses", {
    model, stream: true,
    input: [{ role: "user", content: [{ type: "input_text", text: prompt }, { type: "input_image", image_url: imageDataUrl }] }],
  }, true);
  let text = "", usage: any = null, buf = "";
  const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "response.output_text.delta") text += ev.delta;
        if (ev.type === "response.completed") usage = ev.response?.usage;
      } catch { /* ignore */ }
    }
  }
  const n = usage?.images_processed ?? 1;
  const cost = n * PRICES[model].perImage!;
  charge(model, cost);
  return { text, usage, cost, ms: performance.now() - t, model };
}

// Muse Image via /v1/responses (multi-turn with previous_response_id).
export async function image(prompt: string, imageDataUrl?: string, previousId?: string): Promise<CallResult & { id: string; b64: string }> {
  const model = "muse-image-1.0"; guard(model);
  const t = performance.now();
  const content: any[] = [{ type: "input_text", text: prompt }];
  if (imageDataUrl) content.push({ type: "input_image", image_url: imageDataUrl });
  const body: any = { model, input: [{ role: "user", content }], tools: [{ type: "image_generation", output_format: "jpeg" }] };
  if (previousId) body.previous_response_id = previousId;
  const r = await post("/responses", body);
  const d = await r.json();
  const img = (d.output ?? []).find((o: any) => o.type === "image_generation_call");
  const b64 = img?.result ?? "";
  if (!b64) throw new Error("Muse Image returned no image: " + JSON.stringify(d).slice(0, 300));
  const cost = PRICES[model].perImage!;
  charge(model, cost);
  return { text: "", usage: d.usage, cost, ms: performance.now() - t, model, id: d.id, b64 };
}
