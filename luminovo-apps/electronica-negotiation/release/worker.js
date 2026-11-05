// worker/index.ts
var APP = "electronica-negotiation";
var API = "https://mcp.luminovo.com/api";
var PLATFORM = "https://mcp.luminovo.com/apps/_api";
var PUBLIC_API = "https://api.luminovo.com";
var Upstream = class extends Error {
  constructor(status, code, hint) {
    super(code);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
  status;
  code;
  hint;
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
async function call(url, init = {}, label = "upstream") {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    console.error(`${label} ${res.status}: ${text.slice(0, 500)}`);
    const status = res.status === 401 ? 403 : res.status >= 500 ? 502 : res.status;
    let hint;
    try {
      hint = JSON.parse(text).hint;
    } catch {
    }
    throw new Upstream(status, `${label}_failed`, hint);
  }
  return text ? JSON.parse(text) : null;
}
var getJson = (path, label) => call(`${API}${path}`, {}, label);
var postJson = (path, body, label) => call(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, label);
async function warehouse(sql) {
  const res = await call(
    `${PLATFORM}/warehouse/query`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql }) },
    "warehouse"
  );
  const body = res.body ?? "";
  return body.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}
var num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var clean = (s) => String(s ?? "").replace(/[^\p{L}\p{N} ._-]/gu, "").slice(0, 60);
async function projects(input) {
  const q = clean(input.q ?? "");
  const m = String(input.q ?? "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (m) {
    const r = await getJson(`/rfqs/${m[0]}`, "rfq");
    const d = r.data;
    return {
      projects: [
        {
          id: d.id,
          name: d.name,
          customer: d.customer?.name ?? "",
          scenarios: d.sourcing_scenarios?.length ?? 0,
          updated: d.creation_date
        }
      ]
    };
  }
  const filter = q ? `AND (r.name ILIKE '%${q}%' OR c.name ILIKE '%${q}%')` : "";
  const rows = await warehouse(`
        SELECT toString(r.id), r.name, coalesce(c.name, ''), count(s.id), toString(max(s.creation_date))
        FROM customer_gold.sourcing_scenario s
        JOIN customer_gold.rfq r ON r.id = s.rfq
        LEFT JOIN customer_gold.customer c ON c.id = r.customer
        WHERE r.is_archived = false ${filter}
        GROUP BY r.id, r.name, c.name
        ORDER BY max(s.creation_date) DESC
        LIMIT 80`);
  return { projects: rows.map(([id, name, customer, scenarios, updated]) => ({ id, name, customer, scenarios: num(scenarios), updated })) };
}
function lineFromCalc(l) {
  const part = l.selected_part ?? l.offer?.linked_part ?? null;
  const loc = l.offer?.linked_location;
  const supplier = loc?.supplier?.name ?? (loc?.type === "InventorySite" ? `Inventory ${loc?.name ?? ""}`.trim() : null);
  const avail = l.availability ?? l.offer_id_and_signature?.signature?.availability;
  const lead = avail?.type === "Stock" ? 0 : avail?.days ?? null;
  const cs = l.cost_summary ?? {};
  return {
    id: l.id,
    status: l.solution_summary?.status?.effective ?? l.line_item_status ?? null,
    mpn: part?.mpn ?? (part?.kind === "Custom" || part?.kind === "CustomFullPart" ? "Custom part" : part?.kind ?? "\u2014"),
    manufacturer: part?.manufacturer?.name ?? "",
    partId: part?.id ?? null,
    qty: num(l.quantities?.required_quantity?.value ?? l.quantities?.aggregated_quantity?.value),
    purchaseQty: num(l.quantities?.total_purchase_quantity?.value),
    unitPrice: num(cs.unit_price?.preferred?.amount ?? cs.effective_unit_price?.preferred?.amount),
    total: num(cs.total_price?.preferred?.amount),
    currency: cs.unit_price?.preferred?.currency ?? cs.total_price?.preferred?.currency ?? null,
    supplier,
    stockLocation: loc?.stock_location ?? null,
    priceType: l.offer?.price_type ?? null,
    leadDays: lead,
    manual: l.selection === "Manual" || (l.solution_summary?.solution_tags ?? []).some((t) => t.tag === "ManualOffer"),
    abc: l.abc_classification?.label ?? null
  };
}
async function project(input) {
  if (!uuidRe.test(input.rfqId ?? "")) return json({ error: "invalid_project" }, 400);
  const rfq = (await getJson(`/rfqs/${input.rfqId}`, "rfq")).data;
  const ids = rfq.sourcing_scenarios ?? [];
  let scenarios = [];
  if (ids.length) {
    const bulk = await postJson("/sourcing-scenarios/bulk", { ids }, "scenarios");
    const byId = new Map((bulk.items ?? []).map((s) => [s.id, s.name]));
    scenarios = ids.map((id) => ({ id, name: String(byId.get(id) ?? "Scenario") }));
  }
  const scenarioId = ids.includes(input.scenarioId) ? input.scenarioId : ids[0];
  let lines = [];
  if (scenarioId) {
    const sel = await postJson("/sourcing/calculation/read-selection", { sourcing_scenario_ids: [scenarioId] }, "selection");
    lines = (sel.items?.[0]?.line_item_calculations ?? []).map(lineFromCalc);
  }
  return json({
    project: {
      id: rfq.id,
      name: rfq.name,
      customer: rfq.customer?.name ?? "",
      currency: rfq.currency ?? lines.find((l) => l.currency)?.currency ?? "EUR",
      number: rfq.ems_internal_number ?? null
    },
    scenarios,
    scenarioId: scenarioId ?? null,
    lines
  });
}
var DROP = /* @__PURE__ */ new Set(["Unavailable", "SupplierExcluded", "NoLongerSelectable", "RejectedPartOption", "Expired", "ExcludedPriceType", "Restricted"]);
var KEEP_TAGS = /* @__PURE__ */ new Set([
  "Selected",
  "QuotePrice",
  "ContractPrice",
  "ListPrice",
  "PurchasePrice",
  "CustomerNegotiatedPrice",
  "LongLeadTime",
  "SupplierNotApproved",
  "SupplierPreferred",
  "SupplierApproved",
  "LowStock",
  "Expiring",
  "OnOrder",
  "UnknownLeadTime",
  "PartAlternative"
]);
async function competition(input) {
  const lineIds = (input.lineIds ?? []).filter((x) => uuidRe.test(x)).slice(0, 12);
  const perLine = await pool(lineIds, 6, async (id) => {
    try {
      const all = await getJson(`/sourcing-line-item/${id}/solutions`, "solutions");
      const valid = all.filter((s) => {
        const tags = (s.tags ?? []).map((t) => t.tag);
        return tags.includes("Selected") || !tags.some((t) => DROP.has(t));
      });
      const price = (s) => num(s.cost?.total_price?.preferred?.amount) || Number.MAX_VALUE;
      valid.sort((a, b) => price(a) - price(b));
      const sols = valid.filter((s, i) => i < 120 || (s.tags ?? []).some((t) => t.tag === "Selected"));
      return { id, sols, count: all.length };
    } catch (e) {
      return { id, sols: [], count: 0 };
    }
  });
  const offerKeys = /* @__PURE__ */ new Set();
  for (const { sols } of perLine)
    for (const s of sols) {
      const o = s.offer_id_and_signature;
      if (o?.id && o?.kind) offerKeys.add(`${o.kind}:${o.id}`);
    }
  const supplierOf = /* @__PURE__ */ new Map();
  const keys = [...offerKeys];
  const chunks = [];
  for (let i = 0; i < keys.length; i += 100) chunks.push(keys.slice(i, i + 100));
  await pool(chunks, 5, async (chunk) => {
    try {
      const res = await call(
        `${PUBLIC_API}/offers/bulk`,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/api.luminovo.offer-v1+json" },
          body: JSON.stringify({ ids: chunk })
        },
        "offers"
      );
      for (const o of res.items ?? []) {
        const loc = o.linked_location ?? {};
        const name = loc.type === "InventorySite" ? `Inventory ${loc.name ?? ""}`.trim() : loc.name;
        if (name) supplierOf.set(o.id, name);
      }
    } catch (e) {
      console.error("offer resolve failed", e);
    }
  });
  const lines = perLine.map(({ id, sols, count }) => {
    const best = /* @__PURE__ */ new Map();
    for (const s of sols) {
      const tags = (s.tags ?? []).map((t) => t.tag);
      const selected = tags.includes("Selected");
      if (!selected && tags.some((t) => DROP.has(t))) continue;
      const o = s.offer_id_and_signature;
      const key = `${o?.kind}:${o?.id}`;
      const supplier = supplierOf.get(key) ?? supplierOf.get(o?.id) ?? null;
      if (!supplier) continue;
      const total = num(s.cost?.total_price?.preferred?.amount);
      if (!total) continue;
      const a = s.availability;
      const opt = {
        supplier,
        total,
        unit: num(s.cost?.unit_price?.preferred?.amount),
        selected,
        leadDays: a?.type === "Stock" ? 0 : a?.days ?? null,
        tags: tags.filter((t) => KEEP_TAGS.has(t))
      };
      const prev = best.get(supplier);
      if (!prev || selected || !prev.selected && total < prev.total) best.set(supplier, opt);
    }
    const options = [...best.values()].sort((a, b) => a.total - b.total).slice(0, 12);
    return { id, options, count };
  });
  return json({ lines });
}
async function portfolioScenarios() {
  const rows = await warehouse(`
        SELECT toString(argMin(s.id, s.creation_date)), toString(r.id), r.name
        FROM customer_gold.sourcing_scenario s
        JOIN customer_gold.rfq r ON r.id = s.rfq
        WHERE r.is_archived = false AND s.creation_date > now() - INTERVAL 365 DAY
        GROUP BY r.id, r.name
        ORDER BY max(s.creation_date) DESC
        LIMIT 60`);
  return json({ scenarios: rows.map(([scenarioId, rfqId, name]) => ({ scenarioId, rfqId, name })) });
}
async function portfolio(input) {
  const ids = (input.scenarioIds ?? []).filter((x) => uuidRe.test(x)).slice(0, 8);
  const out = [];
  await pool(ids, 4, async (sid) => {
    try {
      const sel = await postJson("/sourcing/calculation/read-selection", { sourcing_scenario_ids: [sid] }, "selection");
      const suppliers = {};
      let currency = null;
      for (const l of sel.items?.[0]?.line_item_calculations ?? []) {
        const name = l.offer?.linked_location?.supplier?.name;
        const v = num(l.cost_summary?.total_price?.preferred?.amount);
        currency = currency ?? l.cost_summary?.total_price?.preferred?.currency ?? null;
        if (!name || !v) continue;
        suppliers[name] = suppliers[name] ?? { spend: 0, lines: 0 };
        suppliers[name].spend += v;
        suppliers[name].lines += 1;
      }
      out.push({ scenarioId: sid, currency, suppliers });
    } catch (e) {
      out.push({ scenarioId: sid, error: true, suppliers: {} });
    }
  });
  return json({ results: out });
}
async function complete(req) {
  const res = await fetch(`${PLATFORM}/apps/${APP}/llm/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(req)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Upstream(res.status === 401 ? 403 : res.status, body.error ?? "completion_failed", body.hint);
  return body;
}
var decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).trim();
async function fetchNews(query) {
  try {
    const res = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&mkt=en-US&setlang=en`, {
      headers: { "X-Lumi-Connection": "bing-news", accept: "application/rss+xml" }
    });
    if (res.ok) {
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 10).map((m) => {
        const get = (tag) => decode((m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] ?? "");
        let link = get("link");
        const u = link.match(/[?&]url=([^&]+)/);
        if (u) link = decodeURIComponent(u[1]);
        const date = get("pubDate");
        return { title: get("title"), url: link, source: get("News:Source") || get("source") || "", date: date ? new Date(date).toISOString() : null, snippet: get("description").slice(0, 280) };
      });
      if (items.length) return { items: items.filter((i) => i.title), via: "Bing News" };
    }
  } catch (e) {
    console.error("bing news failed", e);
  }
  try {
    const res = await fetch(
      `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(`"${query}"`)}&mode=artlist&maxrecords=10&format=json&sort=datedesc&timespan=3months`,
      { headers: { "X-Lumi-Connection": "gdelt" } }
    );
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      const items = (body.articles ?? []).map((a) => ({ title: a.title, url: a.url, source: a.domain, date: a.seendate ?? null, snippet: "" }));
      if (items.length) return { items, via: "GDELT" };
    }
  } catch (e) {
    console.error("gdelt failed", e);
  }
  return { items: [], via: null };
}
var NEWS_SCHEMA = {
  type: "object",
  properties: {
    ticker: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "Index of the headline this is about" },
          takeaway: { type: "string", description: "One short line, at most 14 words, why it matters to a buyer" },
          tone: { type: "string", enum: ["positive", "neutral", "watch"] }
        },
        required: ["index", "takeaway", "tone"]
      }
    },
    opener: { type: "string", description: "A natural first sentence or two to open the meeting, referring to one real headline" },
    hook: { type: "string", description: "One line linking the news to the negotiation" }
  },
  required: ["ticker", "opener", "hook"]
};
async function news(input) {
  const supplier = String(input.supplier ?? "").slice(0, 80);
  const query = String(input.query ?? supplier).slice(0, 80);
  if (!supplier) return json({ error: "missing_supplier" }, 400);
  const { items, via } = await fetchNews(query);
  const facts = input.facts ?? {};
  const prompt = [
    `Supplier: ${supplier}`,
    `Meeting: face-to-face at electronica 2026 in Munich (10\u201313 November 2026). Today is ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.`,
    `Our position with them: ${JSON.stringify(facts).slice(0, 1500)}`,
    items.length ? `Recent headlines:
${items.map((n, i) => `[${i}] ${n.date?.slice(0, 10) ?? ""} ${n.source}: ${n.title} \u2014 ${n.snippet}`).join("\n")}` : "No recent headlines were found. Write the opener from our position alone, and return an empty ticker."
  ].join("\n\n");
  let summary = null;
  try {
    const res = await complete({
      model: "fast",
      instructions: `You prepare a procurement buyer for a supplier meeting. Use only the headlines given; never invent news. Keep the opener warm and specific, no flattery, no clich\xE9s, US English. The hook ties the news to volume, pricing or lead times. Money is in ${String(facts.currency ?? "EUR")}; round it to three significant figures (for example \u20AC107M, \u20AC8.4M, \u20AC920k).`,
      prompt,
      schema: NEWS_SCHEMA,
      maxOutputTokens: 900
    });
    summary = res.output ?? null;
  } catch (e) {
    if (e instanceof Upstream) summary = { error: e.code, hint: e.hint };
    else throw e;
  }
  return json({ items, via, summary });
}
var PLAN_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One sentence: the theme of the day" },
    route: {
      type: "array",
      items: {
        type: "object",
        properties: {
          supplier: { type: "string", description: "Exactly as given" },
          objective: { type: "string", description: "What to walk away with, at most 12 words" },
          why: { type: "string", description: "Why this stop matters, citing a number" },
          ask: { type: "string", description: "The one concrete ask" },
          minutes: { type: "integer" }
        },
        required: ["supplier", "objective", "why", "ask", "minutes"]
      }
    },
    remote: {
      type: "array",
      items: {
        type: "object",
        properties: { supplier: { type: "string" }, action: { type: "string" } },
        required: ["supplier", "action"]
      }
    }
  },
  required: ["headline", "route", "remote"]
};
async function plan(input) {
  const prompt = `Project: ${JSON.stringify(input.project ?? {})}
Currency: ${input.currency ?? "EUR"}

Suppliers with a stand at electronica 2026 (hall, stand, our numbers):
${JSON.stringify(input.stops ?? []).slice(0, 12e3)}

Suppliers in this project without a known stand:
${JSON.stringify(input.offFloor ?? []).slice(0, 3e3)}

Hall layout: row A is north, row B in the middle, row C south; halls 1 to 6 run west to east. Entrance West is next to B0/A1/C1, Entrance East next to A6/B6/C6.`;
  const res = await complete({
    model: "balanced",
    instructions: `You plan a buyer's day at electronica. Rank the stands by negotiation value: project spend at stake, lines the supplier could win if they move a little on price (contestable volume and how much of it is within 10%), lines where a competitor is cheaper and they should match, cross-project spend that gives leverage, and how dependent the project is on them. Then order the route so the highest-value stops come first but the walk stays efficient (start at Entrance West, avoid crossing the fairground twice). Include every stand worth more than a courtesy visit, at most 8. Give each stop a concrete ask with a number. Do not repeat the hall or stand in the objective; the card shows it. Phrase every ask as what we ask the supplier to do ("Cut 6% on the four Infineon lines", "Match WinSource on AWR1843"), never as something we offer. Never mention data that is missing or was not provided; work with what is there. Round money to three significant figures with the currency symbol (for example \u20AC107M, \u20AC8.4M, \u20AC920k). Put suppliers without a stand, or not worth a visit, in remote with a follow-up action. Use the supplier names exactly as given. US English, plain and direct.`,
    prompt,
    schema: PLAN_SCHEMA,
    maxOutputTokens: 2500
  });
  return json({ plan: res.output ?? null });
}
var BRIEF_SCHEMA = {
  type: "object",
  properties: {
    stance: { type: "string", description: "One sentence on our negotiating position" },
    goals: { type: "array", items: { type: "string" }, description: "Two or three outcomes for the meeting" },
    asks: {
      type: "array",
      items: {
        type: "object",
        properties: { title: { type: "string" }, detail: { type: "string" }, value: { type: "string", description: "Money or volume involved" } },
        required: ["title", "detail", "value"]
      }
    },
    leverage: { type: "array", items: { type: "string" } },
    give: { type: "array", items: { type: "string" }, description: "What we can offer in return" },
    walkaway: { type: "string" }
  },
  required: ["stance", "goals", "asks", "leverage", "give", "walkaway"]
};
async function brief(input) {
  const res = await complete({
    model: "balanced",
    instructions: "You are a senior electronics procurement negotiator preparing a buyer for a face-to-face meeting at electronica 2026. Build the brief only from the numbers given; cite them. The strongest move is usually volume for price: offer the lines they are close to winning in exchange for a price move, and ask them to match competitors on lines they hold but are not cheapest on. Give at most five asks, the most valuable first. Never mention data that is missing or was not provided. Be specific, short, US English. Round money to three significant figures with the currency symbol (for example \u20AC107M, \u20AC8.4M, \u20AC920k).",
    prompt: JSON.stringify(input).slice(0, 2e4),
    schema: BRIEF_SCHEMA,
    maxOutputTokens: 2e3
  });
  return json({ brief: res.output ?? null });
}
var index_default = {
  async fetch(request) {
    let handler = "";
    try {
      const env = await request.json();
      handler = env.handler;
      const input = env.input ?? {};
      switch (handler) {
        case "projects":
          return json(await projects(input));
        case "project":
          return await project(input);
        case "competition":
          return await competition(input);
        case "portfolioScenarios":
          return await portfolioScenarios();
        case "portfolio":
          return await portfolio(input);
        case "news":
          return await news(input);
        case "plan":
          return await plan(input);
        case "brief":
          return await brief(input);
        default:
          return json({ error: "unknown_handler" }, 404);
      }
    } catch (e) {
      if (e instanceof Upstream) return json({ error: e.code, hint: e.hint }, e.status);
      console.error(`${handler} failed`, e);
      return json({ error: "internal_error" }, 500);
    }
  }
};
export {
  index_default as default
};
