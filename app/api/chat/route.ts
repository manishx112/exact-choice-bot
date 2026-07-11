import { NextResponse } from "next/server";
import {
  normalize,
  parseIntentJS,
  filterData,
  personaLine,
  isGreeting,
  isAppreciation,
  hasProductIntent,
} from "@/lib/intent";
import { Intent } from "@/lib/types";

export const dynamic = "force-dynamic"; // hamesha fresh data

const SCRIPT_URL = process.env.APPS_SCRIPT_URL!;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Groq se SIRF intent nikaalo (data nahi). Fail ho toh JS parser.
async function parseIntentGroq(message: string, prev: Intent | null): Promise<Intent | null> {
  if (!GROQ_KEY) return null;
  const sys = `Tu ek jeans shop ka intent-extractor hai. User ke Hinglish message se
SIRF ye JSON return kar, aur bilkul kuch nahi (no markdown, no text):
{"size": string|null, "rateMin": number|null, "rateMax": number|null, "count": number, "inStock": boolean, "gender": "male"|"female"|null}
- size format "28X32" (uppercase X). Na mile toh null.
- "300 range/aas paas" => rateMin 275, rateMax 325.
- "under/sasta 300" => rateMax 300. "300+ / mehnga" => rateMin 300.
- count default 5. inStock true agar user stock/available maange.
- gender "male" agar user male/men/boy/gents jeans maange, "female" agar female/women/girl/ladies maange, warna null.
- Agar "Previous intent" diya gaya hai: current message sirf jo field explicitly badal/mention kar raha hai wahi update karo, baaki saari fields (size, rateMin, rateMax, count, inStock, gender) previous intent se WAISI HI copy karo. Agar previous intent nahi diya gaya, toh sirf current message se jo detect ho wahi bharo, baaki defaults (size:null, rateMin:null, rateMax:null, count:5, inStock:false, gender:null).`;
  const userContent = prev
    ? `Previous intent: ${JSON.stringify(prev)}\nCurrent message: ${message}`
    : message;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userContent },
        ],
      }),
    });
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content;
    if (!txt) return null;
    const parsed = JSON.parse(txt);
    return {
      size: parsed.size ?? null,
      rateMin: parsed.rateMin ?? null,
      rateMax: parsed.rateMax ?? null,
      count: Math.min(20, parsed.count || 5),
      inStock: !!parsed.inStock,
      gender: parsed.gender === "male" || parsed.gender === "female" ? parsed.gender : null,
    };
  } catch {
    return null; // graceful fallback
  }
}

// Greeting/small-talk ka natural reply — Groq try, warna varied fallback.
const GREETING_FALLBACKS = [
  'Sat Sri Akaal paaji 🙏 Dasso — konsa size te kinne rate de jeans chahide? (jaise: "28x32 me 300 range wale dikha do")',
  "Balle balle paaji! 😄 Vadhiya haan main, tussi dasso — konsa size te budget chahida?",
  "Oye haanji paaji 👋 sab changa ji! Bas size te rate dasso, maal turant dikha denda.",
  "Sat Sri Akaal! 🙏 Tuhada John DV te swagat hai paaji. Size te rate dasso, dikhauna shuru karde aan.",
];

const GREETING_SYS = `Tu "John DV" hai — ek dosaana Punjabi jeans-wala paaji jo WhatsApp business chat te
customers nu jeans bechda hai. Customer ne sirf greeting/small-talk kiti hai (jaise hi, hello,
how are you, sat sri akaal). Usnu garmjoshi wala, chota jiha (1-2 lines) Hinglish/Punjabi mix reply
de, thode emoji use kar sakda hai, te fer usnu size/rate dasan laayi puch (ek chota example de sakda
hai jiven "28x32 me 300 range wale dikha do"). Sirf plain text reply de — no markdown, no JSON.`;

// Thanks/appreciation ka natural reply — Groq try, warna varied fallback.
const APPRECIATION_FALLBACKS = [
  "Koi na paaji, sada kaam hi ehi hai 🙏 Hor kuch dikhawan?",
  "Dhanwaad paaji! 😄 Hor size ya rate dasso, changa maal dikha denge.",
  "Sada pyar sadaa rahega paaji 🙌 Hor jeans vekhne ne toh dasso.",
  "Vadhiya paaji! 🙏 Jado v hor jeans chahide, yaad rakhna, main ithe haan.",
];

const APPRECIATION_SYS = `Tu "John DV" hai — ek dosaana Punjabi jeans-wala paaji jo WhatsApp business chat te
customers nu jeans bechda hai. Customer ne tuhanu thanks/compliment dita hai (jaise "good job",
"thanks", "nice"). Usnu chota jiha (1-2 lines) garmjoshi wala Hinglish/Punjabi mix "welcome"/acknowledgment
reply de, thode emoji use kar sakda hai, te halke jihe pucho ki hor koi size/rate dikhawan. Sirf plain
text reply de — no markdown, no JSON.`;

// Kuch v general chit-chat/sawal (jaise "what is your name") jis vich koi
// product-intent signal nahi — Groq try, warna varied fallback.
const GENERAL_FALLBACKS = [
  "Main John DV haan paaji 👳 tuhada apna jeans wala! Dasso, konsa size te rate chahida?",
  "Haha changa sawal paaji 😄 Main John DV, jeans da mahir! Size/rate dasso, maal dikha denda.",
  "Ohi haan jehda tuhanu vadhiya jeans dinda — John DV! Size te rate dasso paaji.",
];

const GENERAL_SYS = `Tu "John DV" hai — ek dosaana Punjabi jeans-wala paaji jo WhatsApp business chat te
customers nu jeans bechda hai. Customer ne koi general sawal ya chit-chat kiti hai jo jeans ke
size/rate/stock mangne wala nahi hai (jaise "what is your name", "are you a bot", koi random gal).
Apne persona vich (John DV, jeans wala paaji) chota jiha (1-2 lines) dosaana Hinglish/Punjabi mix
jawab de, te fer halke jehe size/rate dasan laayi puch le. Sirf plain text reply de — no markdown,
no JSON.`;

async function smallTalkReplyGroq(message: string, sys: string): Promise<string | null> {
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
        temperature: 0.9,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: message },
        ],
      }),
    });
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content?.trim();
    if (!txt) console.error("[smallTalkReplyGroq]", j?.error?.message || j);
    return txt || null;
  } catch (e) {
    console.error("[smallTalkReplyGroq] threw:", e);
    return null; // graceful fallback
  }
}

export async function POST(req: Request) {
  try {
    const { message, prevIntent } = await req.json();
    if (!message) return NextResponse.json({ error: "empty" }, { status: 400 });
    const prev: Intent | null = prevIntent ?? null;

    // 0) sirf greeting/thanks/small-talk hai toh product list mat dikhao
    if (isGreeting(message)) {
      const reply =
        (await smallTalkReplyGroq(message, GREETING_SYS)) ||
        GREETING_FALLBACKS[Math.floor(Math.random() * GREETING_FALLBACKS.length)];
      return NextResponse.json({ reply, cards: [], intent: null });
    }
    if (isAppreciation(message)) {
      const reply =
        (await smallTalkReplyGroq(message, APPRECIATION_SYS)) ||
        APPRECIATION_FALLBACKS[Math.floor(Math.random() * APPRECIATION_FALLBACKS.length)];
      return NextResponse.json({ reply, cards: [], intent: null });
    }

    // koi bhi product-intent signal (size/rate/stock) nahi mila toh
    // ye general chit-chat/sawal hai — product list mat dikhao.
    if (!hasProductIntent(message)) {
      const reply =
        (await smallTalkReplyGroq(message, GENERAL_SYS)) ||
        GENERAL_FALLBACKS[Math.floor(Math.random() * GENERAL_FALLBACKS.length)];
      return NextResponse.json({ reply, cards: [], intent: null });
    }

    // 1) live data (har request pe fresh)
    const dataRes = await fetch(SCRIPT_URL, { cache: "no-store" });
    const dataJson = await dataRes.json();
    const data = normalize(dataJson.data || []);

    // 2) intent: Groq try, warna JS (dono conversation ka prev intent carry karte hai)
    const intent = (await parseIntentGroq(message, prev)) || parseIntentJS(message, prev);

    // 3) deterministic filter (yahi sach hai, LLM nahi)
    const cards = filterData(data, intent);

    // 4) persona line
    const reply = personaLine(intent, cards.length);

    return NextResponse.json({ reply, cards, intent });
  } catch (e: any) {
    return NextResponse.json(
      { reply: "Oye paaji server thoda atak gaya 😅 dobara try karo.", cards: [] },
      { status: 200 }
    );
  }
}
