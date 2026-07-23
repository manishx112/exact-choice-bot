import { NextResponse } from "next/server";
import { normalize, filterData, personaLine, getCatalogSummary } from "@/lib/intent";
import { Intent, Jean } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCRIPT_URL = process.env.APPS_SCRIPT_URL!;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function groq(
  messages: { role: string; content: string }[],
  json: boolean,
  temp: number
): Promise<string | null> {
  if (!GROQ_KEY) return null;
  try {
    const body: any = { model: GROQ_MODEL, temperature: temp, messages };
    if (json) body.response_format = { type: "json_object" };
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    return j?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("[groq]", e);
    return null;
  }
}

// ── Step 1: Decide action + extract intent ────────────────────────
async function decideAction(
  message: string,
  prev: Intent | null,
  historyLines: string,
  summary: ReturnType<typeof getCatalogSummary>
): Promise<{ action: "chat" | "show"; intent: Intent | null; chatReply?: string } | null> {
  const sys = `Tu "John DV" hai — Delhi Tank Road / Gandhi Nagar ka wholesale jeans trader. WhatsApp pe customer se baat kar raha hai.

INVENTORY:
- Male jeans: ${summary.maleCount} items, ₹${summary.maleMinRate}–₹${summary.maleMaxRate}
- Ladies/B: ${summary.bCount} items, ₹${summary.bMinRate}–₹${summary.bMaxRate}
- MOQ: 1 lot (15-20 pcs), COD available, 2-4 din delivery, Tank Road/Gandhi Nagar Delhi

Return JSON:
{
  "action": "chat" | "show",
  "reply": "..." (ONLY when action=chat),
  "intent": {...} (ONLY when action=show)
}

action="show" → Customer WANTS TO SEE products: "dikha do", "dikhao", "28x32 me 300 wale", "sasta lot", "ha dikha do"
action="chat" → Everything else: greeting, negotiation, FAQ, order booking, thanks, general talk

When action="chat": Give natural 1-2 line Delhi Hinglish WhatsApp reply in "reply" field. intent=null.
When action="show": Set intent with: size(28X32/30/null), excludeSize, rateMin, rateMax, gender(male/female/null), inStock, style, count(how many to show, default 5). reply field omit or null.
- If user confirms previous suggestion ("ha dikha do","haan"), copy previous intent.
- If previous intent exists, carry forward unchanged fields.`;

  const userMsg = prev
    ? `Previous intent: ${JSON.stringify(prev)}\n\nChat:\n${historyLines}\n\nCustomer: "${message}"`
    : `Chat:\n${historyLines}\n\nCustomer: "${message}"`;

  const txt = await groq(
    [{ role: "system", content: sys }, { role: "user", content: userMsg }],
    true, 0.2
  );
  if (!txt) return null;

  try {
    const p = JSON.parse(txt);
    if (p.action === "chat") {
      return { action: "chat", intent: null, chatReply: p.reply || "" };
    }
    // action = show
    const raw = p.intent || {};
    return {
      action: "show",
      intent: {
        size: raw.size ? String(raw.size).toUpperCase() : null,
        excludeSize: raw.excludeSize ? String(raw.excludeSize).toUpperCase() : null,
        rateMin: raw.rateMin ?? null,
        rateMax: raw.rateMax ?? null,
        count: Math.min(20, raw.count || 5),
        inStock: !!raw.inStock,
        gender: raw.gender === "male" || raw.gender === "female" ? raw.gender : null,
        style: raw.style ? String(raw.style) : null,
      },
    };
  } catch {
    return null;
  }
}

// ── Step 2: Generate reply AFTER knowing actual results ───────────
async function generateShowReply(
  message: string,
  cards: Jean[],
  intent: Intent,
  historyLines: string
): Promise<string | null> {
  const found = cards.length;
  const cardList = cards.slice(0, 5).map(c => `#${c.s} ${c.size} ₹${c.rate}`).join(", ");

  const sys = `Tu "John DV" hai — Delhi wholesale jeans trader. Customer ne products dekhne bole the.

ACTUAL SEARCH RESULT: ${found} items mili hain${found > 0 ? `: ${cardList}` : ""}
Filter: size=${intent.size||"all"}, rate=₹${intent.rateMin||"?"}-₹${intent.rateMax||"?"}, gender=${intent.gender||"all"}

Reply rules:
- 1 short line, natural Delhi Hinglish
- ${found > 0 ? `Exactly ${found} items mili hain, wo introduce kar. End with 👇` : "Batao kuch nahi mila aur kya available hai suggest kar."}
- Count SAHI batao — ${found} items. Jhooth mat bol.
- NO markdown, plain text only`;

  return groq(
    [{ role: "system", content: sys }, { role: "user", content: `Customer: "${message}"` }],
    false, 0.5
  );
}

export async function POST(req: Request) {
  try {
    const { message, prevIntent, history } = await req.json();
    if (!message) return NextResponse.json({ error: "empty" }, { status: 400 });
    const prev: Intent | null = prevIntent ?? null;
    const chatHistory: { role: string; text: string }[] = history || [];

    // Build chat context
    const historyLines = chatHistory
      .slice(-6)
      .map((h) => `${h.role === "user" ? "Customer" : "John DV"}: ${h.text}`)
      .join("\n");

    // 1) Fetch live catalog
    const dataRes = await fetch(SCRIPT_URL, { cache: "no-store" });
    const dataJson = await dataRes.json();
    const data = normalize(dataJson.data || []);
    const summary = getCatalogSummary(data);

    // 2) Decide: chat or show products?
    const decision = await decideAction(message, prev, historyLines, summary);

    if (!decision) {
      // Groq failed — simple fallback
      return NextResponse.json({
        reply: "Bhaiya size aur rate range bataiye, best lot dikha deta hoon! 🔥",
        cards: [], intent: prev,
      });
    }

    // 3a) CHAT — pure conversation, no cards
    if (decision.action === "chat") {
      return NextResponse.json({
        reply: decision.chatReply || "Haanji bhaiya! 😄",
        cards: [],
        intent: prev, // preserve previous intent for future context
      });
    }

    // 3b) SHOW — filter products, then generate accurate reply
    const intent = decision.intent!;
    const cards = filterData(data, intent);

    const reply =
      (await generateShowReply(message, cards, intent, historyLines)) ||
      personaLine(intent, cards.length, data);

    return NextResponse.json({ reply, cards, intent });
  } catch (e: any) {
    console.error("[POST]", e);
    return NextResponse.json(
      { reply: "Bhaiya server thoda busy hai 😅 ek baar dobara message bhejiye.", cards: [] },
      { status: 200 }
    );
  }
}
