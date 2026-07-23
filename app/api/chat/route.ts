import { NextResponse } from "next/server";
import { normalize, filterData, personaLine, getCatalogSummary } from "@/lib/intent";
import { Intent, Jean } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCRIPT_URL = process.env.APPS_SCRIPT_URL!;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function groqJSON(
  messages: { role: string; content: string }[],
  temp = 0.2
): Promise<any | null> {
  if (!GROQ_KEY) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: temp,
        response_format: { type: "json_object" },
        messages,
      }),
    });
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content?.trim();
    return txt ? JSON.parse(txt) : null;
  } catch (e) {
    console.error("[groqJSON]", e);
    return null;
  }
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

    // 2) Build chat context
    const historyLines = chatHistory
      .slice(-6)
      .map((h) => `${h.role === "user" ? "Customer" : "John DV"}: ${h.text}`)
      .join("\n");

    // 3) One smart LLM call — decides action + reply + intent
    const sys = `Tu "John DV" hai — Delhi Tank Road / Gandhi Nagar ka wholesale jeans trader. WhatsApp pe customer se baat kar raha hai.

INVENTORY:
- Male jeans: ${summary.maleCount} items, ₹${summary.maleMinRate}–₹${summary.maleMaxRate}
- Ladies/B group: ${summary.bCount} items, ₹${summary.bMinRate}–₹${summary.bMaxRate}
- MOQ: 1 lot (15-20 pcs), COD (token + delivery), 2-4 din delivery, Tank Road/Gandhi Nagar Delhi

Return JSON:
{
  "action": "chat" | "show",
  "reply": "...",
  "intent": { "size": null, "excludeSize": null, "rateMin": null, "rateMax": null, "gender": null, "inStock": false, "style": null } | null
}

WHEN TO USE "show" (product cards dikhao):
- Customer EXPLICITLY products dekhna chahta hai: "dikha do", "dikhao", "28x32 me 300 wale", "male jeans 400 range", "sasta lot", "stock dikhao"
- Customer ne size + rate bola hai aur dekhna chahta hai
- Customer ne previous suggestion confirm kiya: "ha dikha do", "haan", "ok dikhao"

WHEN TO USE "chat" (sirf baat karo, NO products):
- Greeting: "hi", "hello", "namaste", "kaise ho"
- Negotiation: "thoda kam karo", "aur sasta?", "kitne ka doge 100 pcs me?"
- FAQ: "COD milega?", "kahan se ho?", "delivery kitne din?"
- Order booking: "ye wala book karo", "order confirm", "le lunga", "pack karo"
- Appreciation: "thanks", "badiya", "shukriya"
- General chat: "kya hai ye?", "aur batao", random questions
- IMPORTANT: Agar customer ne products already dekh liye hain aur ab negotiation / order / questions kar raha hai → "chat", cards mat dikhao

REPLY RULES:
- 1-2 short lines, natural Delhi Hinglish WhatsApp style
- Agar action "show": reply me "👇" lagao end me
- Agar action "chat": warm human reply, NO 👇
- Jo puchha wo jawab de. Kuch aur mat batao.

INTENT RULES (sirf jab action = "show"):
- size: "28X32" ya "30". Na mile toh null
- "300-350" = rateMin:300, rateMax:350
- "under 400" = rateMax:400
- "sasta" = rateMax:9999
- gender: "male"/"female"/null
- style: specific 3-5 digit number like "#1841"
- Agar previous intent hai aur user confirm kar raha hai, copy previous intent as-is
- Agar action = "chat", intent null bhejo`;

    const userMsg = prev
      ? `Previous intent: ${JSON.stringify(prev)}\n\nChat:\n${historyLines}\n\nCustomer: "${message}"`
      : `Chat:\n${historyLines}\n\nCustomer: "${message}"`;

    const result = await groqJSON(
      [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      0.25
    );

    // 4) Process LLM response
    if (result) {
      const action: "chat" | "show" = result.action === "show" ? "show" : "chat";
      let reply: string = result.reply || "";

      if (action === "chat") {
        // Pure conversation — no cards, preserve previous intent for context
        return NextResponse.json({ reply, cards: [], intent: prev });
      }

      // action === "show" — extract intent, filter, show cards
      const rawIntent = result.intent || {};
      const intent: Intent = {
        size: rawIntent.size ? String(rawIntent.size).toUpperCase() : null,
        excludeSize: rawIntent.excludeSize ? String(rawIntent.excludeSize).toUpperCase() : null,
        rateMin: rawIntent.rateMin ?? null,
        rateMax: rawIntent.rateMax ?? null,
        count: 5,
        inStock: !!rawIntent.inStock,
        gender: rawIntent.gender === "male" || rawIntent.gender === "female" ? rawIntent.gender : null,
        style: rawIntent.style ? String(rawIntent.style) : null,
      };

      const cards = filterData(data, intent);

      // If LLM said "show" but 0 cards found, adjust reply
      if (cards.length === 0 && !reply.includes("nahi") && !reply.includes("start")) {
        reply = personaLine(intent, 0, data);
      }

      // Ensure 👇 on replies with cards
      if (cards.length > 0 && !reply.includes("👇")) {
        reply += " 👇";
      }

      return NextResponse.json({ reply, cards, intent });
    }

    // 5) Fallback if Groq fails — simple JS parser
    return NextResponse.json({
      reply: "Bhaiya size aur rate range bataiye, best designs dikha deta hoon! 🔥",
      cards: [],
      intent: prev,
    });
  } catch (e: any) {
    console.error("[POST]", e);
    return NextResponse.json(
      { reply: "Bhaiya server thoda busy hai 😅 ek baar dobara message bhejiye.", cards: [] },
      { status: 200 }
    );
  }
}
