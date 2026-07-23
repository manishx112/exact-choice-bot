import { NextResponse } from "next/server";
import {
  normalize,
  parseIntentJS,
  filterData,
  personaLine,
  getCatalogSummary,
} from "@/lib/intent";
import { Intent, Jean } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCRIPT_URL = process.env.APPS_SCRIPT_URL!;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// ── Groq Helper ──────────────────────────────────────────────────
async function groqChat(
  messages: { role: string; content: string }[],
  json = false,
  temp = 0.25
): Promise<string | null> {
  if (!GROQ_KEY) return null;
  try {
    const body: any = { model: GROQ_MODEL, temperature: temp, messages };
    if (json) body.response_format = { type: "json_object" };
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const j = await res.json();
    return j?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("[groqChat]", e);
    return null;
  }
}

// ── Step 1: Extract structured intent from message ────────────────
async function extractIntent(
  message: string,
  prev: Intent | null,
  chatHistory: { role: string; text: string }[]
): Promise<Intent | null> {
  // Build short chat context (last 4 turns max)
  const historyLines = chatHistory
    .slice(-4)
    .map((h) => `${h.role === "user" ? "Customer" : "John DV"}: ${h.text}`)
    .join("\n");

  const sys = `Tu ek wholesale jeans shop ka intent-extractor hai.

User ke Hinglish message se structured intent JSON nikal. SIRF ye JSON return kar:
{"size":string|null,"excludeSize":string|null,"rateMin":number|null,"rateMax":number|null,"count":number,"inStock":boolean,"gender":"male"|"female"|null,"style":string|null}

Rules:
- size: "28X32" ya single "30". Na mile toh null.
- "300-350" ya "300 se 350" = rateMin:300, rateMax:350
- "300 range" / "300 ke aas paas" = rateMin:275, rateMax:325
- "under 400" / "400 tak" = rateMax:400
- "sasta" = rateMax:9999 (sabse sasta)
- count: default 5
- gender: "male" if male/men/boy/gents/ladke, "female" if women/girl/ladies, else null
- style: specific style number (3-5 digits), not a rate. e.g. "#1841" => style:"1841"
- excludeSize: "32X36 se alag" => excludeSize:"32X36", size:null
- If user says "ha", "haan", "ok", "dikha do", "yes", "theek hai" = CONFIRMATION. Copy ALL fields from previous intent AS-IS. Don't change anything.
- If previous intent given, carry forward unchanged fields. Only update what user explicitly changes.`;

  const userMsg = prev
    ? `Previous intent: ${JSON.stringify(prev)}\n\nRecent chat:\n${historyLines}\n\nCurrent message: "${message}"`
    : `Current message: "${message}"`;

  const txt = await groqChat(
    [
      { role: "system", content: sys },
      { role: "user", content: userMsg },
    ],
    true,
    0
  );
  if (!txt) return null;

  try {
    const p = JSON.parse(txt);
    return {
      size: p.size ? String(p.size).toUpperCase() : null,
      excludeSize: p.excludeSize ? String(p.excludeSize).toUpperCase() : null,
      rateMin: p.rateMin ?? null,
      rateMax: p.rateMax ?? null,
      count: Math.min(20, p.count || 5),
      inStock: !!p.inStock,
      gender: p.gender === "male" || p.gender === "female" ? p.gender : null,
      style: p.style ? String(p.style) : null,
    };
  } catch {
    return null;
  }
}

// ── Step 2: Generate human reply based on ACTUAL results ──────────
async function generateReply(
  message: string,
  intent: Intent,
  cards: Jean[],
  chatHistory: { role: string; text: string }[],
  summary: ReturnType<typeof getCatalogSummary>
): Promise<string | null> {
  const historyLines = chatHistory
    .slice(-6)
    .map((h) => `${h.role === "user" ? "Customer" : "John DV"}: ${h.text}`)
    .join("\n");

  const cardSummary =
    cards.length > 0
      ? cards
          .slice(0, 5)
          .map((c) => `Style#${c.s} Size:${c.size} ₹${c.rate}`)
          .join(", ")
      : "KUCH NAHI MILA";

  const sys = `Tu "John DV" hai — Delhi ki Tank Road / Gandhi Nagar market ka real wholesale jeans trader.
Tu WhatsApp par apne customer se baat kar raha hai. Natural, warm, human jaisa reply de.

INVENTORY FACTS:
- Male jeans: ${summary.maleCount} designs, ₹${summary.maleMinRate}-₹${summary.maleMaxRate}
- Ladies/Group B: ${summary.bCount} designs, ₹${summary.bMinRate}-₹${summary.bMaxRate}
- MOQ: 1 lot (15-20 pcs), COD available (token + delivery), 2-4 din delivery

SEARCH RESULT (ye tere inventory search ka actual result hai):
- Cards found: ${cards.length}
- Items: ${cardSummary}
- Filter used: size=${intent.size || "all"}, rate=₹${intent.rateMin || "any"}-₹${intent.rateMax || "any"}, gender=${intent.gender || "all"}

RULES:
1. Reply SIRF 1-2 chhoti lines me de. WhatsApp jaisa short message.
2. Agar cards mili hain (${cards.length} > 0): Introduce kar naturally. "Ye dekhiye bhaiya..." / "Haanji! Mast designs hain..."
   End with 👇
3. Agar 0 cards mili: Batao kyun nahi mili. Kya available hai wo suggest kar.
   Example: "Bhaiya male jeans ₹${summary.maleMinRate} se start hain, wo dikhaun?"
4. Greeting/small-talk ka natural jawab de, fir size/rate puch.
5. FAQ (location, COD, delivery, quality) ka seedha jawab de facts se.
6. IMPORTANT: Reply DIRECTLY relate kare customer ke message se. Jo puchha wo jawab de.
7. Hindi-English mix natural Delhi trader style. Emoji 1-2 use kar.
8. NO markdown, NO quotes around reply, ONLY plain text.`;

  const userMsg = `Chat history:\n${historyLines}\n\nCustomer ka latest message: "${message}"`;

  return groqChat(
    [
      { role: "system", content: sys },
      { role: "user", content: userMsg },
    ],
    false,
    0.6
  );
}

export async function POST(req: Request) {
  try {
    const { message, prevIntent, history } = await req.json();
    if (!message) return NextResponse.json({ error: "empty" }, { status: 400 });
    const prev: Intent | null = prevIntent ?? null;
    const chatHistory: { role: string; text: string }[] = history || [];

    // 1) Fetch live catalog
    const dataRes = await fetch(SCRIPT_URL, { cache: "no-store" });
    const dataJson = await dataRes.json();
    const data = normalize(dataJson.data || []);
    const summary = getCatalogSummary(data);

    // 2) Extract intent (Groq LLM → JS fallback)
    const intent =
      (await extractIntent(message, prev, chatHistory)) ||
      parseIntentJS(message, prev);

    // 3) Filter products deterministically
    const cards = filterData(data, intent);

    // 4) Generate human reply based on ACTUAL search results
    const llmReply = await generateReply(
      message,
      intent,
      cards,
      chatHistory,
      summary
    );
    const reply = llmReply || personaLine(intent, cards.length, data);

    return NextResponse.json({ reply, cards, intent });
  } catch (e: any) {
    console.error("[POST]", e);
    return NextResponse.json(
      {
        reply: "Bhaiya server thoda busy hai 😅 ek baar dobara message bhejiye.",
        cards: [],
      },
      { status: 200 }
    );
  }
}
