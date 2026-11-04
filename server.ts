// Genesis Pro Builder server. MODEL_API_KEY stays server-side; the browser never sees it.
import { Run } from "./lib/pipeline.ts";
import { COST_CAP_USD, ledger } from "./lib/meta.ts";

const runs = new Map<string, Run>();
const PORT = Number(Deno.env.get("PORT") ?? "8787");
const TYPES: Record<string, string> = { html: "text/html; charset=utf-8", js: "text/javascript", css: "text/css", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", json: "application/json", svg: "image/svg+xml", webp: "image/webp" };

async function file(path: string) {
  try {
    const data = await Deno.readFile(path);
    return new Response(data, { headers: { "content-type": TYPES[path.split(".").pop()!] ?? "application/octet-stream", "cache-control": "no-store" } });
  } catch { return new Response("not found", { status: 404 }); }
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

function evalSummary() {
  const out: any[] = [];
  for (const d of Deno.readDirSync("./runs")) {
    try { out.push(JSON.parse(Deno.readTextFileSync(`./runs/${d.name}/summary.json`))); } catch { /* running */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

Deno.serve({ port: PORT, hostname: "0.0.0.0" }, async (req) => {
  const u = new URL(req.url);
  const p = u.pathname;
  if (p === "/" ) return file("./public/index.html");
  if (p.startsWith("/public/") || p.startsWith("/samples/")) return file("." + p.replace(/\.\./g, ""));
  const rm = p.match(/^\/runs\/([\w-]+)\/(preview\.html|preview\.png|mock-\d+\.jpg|events\.json|summary\.json)$/);
  if (rm) return file(`./runs/${rm[1]}/${rm[2]}`);
  if (p === "/api/ledger") return json({ ...ledger(), cap: COST_CAP_USD });
  if (p === "/api/eval") return json(evalSummary());
  if (p === "/api/run" && req.method === "POST") {
    const b = await req.json();
    if (typeof b.image !== "string" || !b.image.startsWith("data:image/") || b.image.length > 6_000_000) return json({ error: "bad image" }, 400);
    const run = new Run(b.image, { injectFault: !!b.injectFault, label: String(b.label ?? "") });
    await Deno.writeFile(`${run.dir}/input.txt`, new TextEncoder().encode(b.label ?? ""));
    runs.set(run.id, run);
    run.go();
    return json({ id: run.id });
  }
  const m = p.match(/^\/api\/run\/([\w-]+)\/(stream|mock|state)$/);
  if (m) {
    const run = runs.get(m[1]);
    if (!run) return json({ error: "unknown run" }, 404);
    if (m[2] === "state") return json({ events: run.events, state: { ...run.state }, done: run.done, cost: run.cost });
    if (m[2] === "mock" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      try { await run.mock(b.prompt); return json({ ok: true }); } catch (e) { return json({ error: String(e) }, 500); }
    }
    if (m[2] === "stream") {
      let fn: (e: any) => void;
      const body = new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          const send = (e: any) => c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          for (const e of run.events) send(e);
          fn = send; run.listeners.add(fn);
        },
        cancel() { run.listeners.delete(fn); },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    }
  }
  return new Response("not found", { status: 404 });
});
console.log(`Genesis Pro Builder on http://localhost:${PORT}`);
