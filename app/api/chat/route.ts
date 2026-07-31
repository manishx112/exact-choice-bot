import { NextResponse } from "next/server";
import {
  normalize,
  filterAll,
  taggedStyleNumber,
  getCatalogSummary,
  routeAction,
  parseIntentJS,
  detectFAQ,
  smallTalkLine,
  checkAvailability,
  availabilityAnswer,
  isMoreRequest,
  keyOf,
  showLine,
  isLastLotQuestion,
  lastLotAnswer,
  isAffirmation,
  ackAfterCards,
  sameLotLine,
  parseOrderQty,
  orderAnswer,
} from "@/lib/intent";
import { Intent, Jean } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCRIPT_URL = process.env.APPS_SCRIPT_URL!;
const GROQ_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

async function groq(messages: { role: string; content: string }[], temp: number): Promise<string | null> {
  if (!GROQ_KEY) return null;
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({ model: GROQ_MODEL, temperature: temp, max_tokens: 220, messages }),
      // customer 8 sec se zyada wait kare, usse achha deterministic reply chala do
      signal: AbortSignal.timeout(8000),
    });
    const j = await res.json();
    return j?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error("[groq]", e);
    return null;
  }
}

// ── catalog cache ──────────────────────────────────────────────────
// Apps Script khud 2-7 sec leta hai, aur ek saath 2-3 hit karo toh queue
// lag ke 30+ sec ho jaata hai. Isliye:
//   • 5 min TTL (sheet din me ek-do baar hi badalti hai)
//   • stale-while-revalidate — customer purana data turant paata hai
//   • in-flight dedup — ek time par sirf ek hi fetch jaayega
let catalogCache: { at: number; data: Jean[] } | null = null;
let inFlight: Promise<Jean[]> | null = null;
const CATALOG_TTL = 5 * 60_000;

async function fetchCatalog(): Promise<Jean[]> {
  try {
    const res = await fetch(SCRIPT_URL, { cache: "no-store", signal: AbortSignal.timeout(20000) });
    const j = await res.json();
    const data = normalize(j.data || []);
    if (data.length) catalogCache = { at: Date.now(), data };
    return catalogCache?.data || [];
  } catch (e) {
    console.error("[catalog]", e);
    return catalogCache?.data || []; // sheet down — purana data hi sahi
  } finally {
    inFlight = null;
  }
}

async function getCatalog(): Promise<Jean[]> {
  const fresh = catalogCache && Date.now() - catalogCache.at < CATALOG_TTL;
  if (fresh) return catalogCache!.data;

  const job = inFlight || (inFlight = fetchCatalog());
  // purana data haath me hai toh customer ko intezaar mat karao —
  // refresh background me chalta rahega
  if (catalogCache) {
    job.catch(() => {});
    return catalogCache.data;
  }
  return job;
}

// ── WhatsApp jaisa saaf text: markdown, bullet, extra line hatao ──────
function humanize(text: string, fallback: string): string {
  if (!text) return fallback;
  let t = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_#>`]/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\n{3,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  // LLM kabhi kabhi "Here is..." type angrezi preamble laga deta hai
  t = t.replace(/^(here (is|are)|sure[,!]?|reply:)\s*/i, "").trim();
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return fallback;
  // akela emoji wali line ajeeb lagti hai — upar wali line me jod do
  for (let i = lines.length - 1; i > 0; i--) {
    if (!/[\p{L}\p{N}]/u.test(lines[i])) {
      lines[i - 1] = `${lines[i - 1]} ${lines[i]}`.trim();
      lines.splice(i, 1);
    }
  }
  return lines.slice(0, 4).join("\n");
}

// John DV ka style guide — har reply isi tone me
const PERSONA = `Tu "John DV" hai — Delhi Tank Road / Gandhi Nagar ka wholesale jeans trader.
Customer se WhatsApp par baat kar raha hai.

BOLNE KA TAREEKA:
- Delhi wali seedhi Hinglish, jaise dukaandaar bolta hai. Roman script.
- 2 se 3 chhoti lines. Har line apni baat. Paragraph mat likh.
- Customer ne jo poocha uska pehle jawaab, phir agla sawaal.
- Zyada se zyada 1 emoji. Markdown, bullet, star, heading bilkul nahi.
- Customer ko "bhaiya" bol. Khud ko "hum/main".
- Jhooth kabhi nahi. Jo number diye gaye hain sirf wahi bol.
- Filler line mat likh ("hum stock rakhte hain" type). Har line me kaam ki baat.`;

// draft me jo ginti/rate hai bas wahi allowed hai — LLM naya number ghusaye
// toh reply reject. ("Rate ₹440 se ₹405 tak" jaisi ulti-seedhi line yahin rukti hai)
function numsOf(t: string): string[] {
  return t.match(/\d+/g) || [];
}

function keepsFacts(out: string, draft: string): boolean {
  const allowed = new Set(numsOf(draft));
  return numsOf(out).every((n) => allowed.has(n));
}

// cards ja hi nahi rahe toh "👇" jhootha ishaara hai — hata do
function stripPointer(text: string): string {
  // NOTE: `u` flag zaroori hai — bina uske emoji ka surrogate pair aadha katta
  // hai aur screen par "�" dikhta hai
  return text
    .replace(/👇|👉|⬇️|⬇/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

// deterministic draft ko sirf "insaan jaisa" bana ke wapas lo — data wahi rahega
async function polish(draft: string, message: string, historyLines: string): Promise<string> {
  const sys = `${PERSONA}

Neeche "DRAFT" diya hai — usme jo likha hai wahi sach hai.
Tera kaam sirf usko natural WhatsApp Hinglish me dobara likhna hai.

NIYAM (todna mana hai):
- Sirf wahi numbers likh jo DRAFT me hain. Naya rate, naya count, nayi size mat bana.
- Draft me jo baat nahi hai wo mat jodo.
- Draft ki aakhri line ka matlab wahi rakh. Draft me photo bhejne ki baat na ho toh
  "photo bhej raha hoon" mat likh.
- Sirf final reply likh, koi explanation nahi.`;

  const user = `Pichhli baat:\n${historyLines || "(nayi chat)"}\n\nCustomer: "${message}"\n\nDRAFT:\n${draft}`;
  const out = await groq([{ role: "system", content: sys }, { role: "user", content: user }], 0.55);
  if (!out) return draft;
  const clean = humanize(out, draft);
  return keepsFacts(clean, draft) ? clean : draft;
}

// page khulte hi cache garam kar do — pehla message tab instant lagta hai
export async function GET() {
  const data = await getCatalog();
  return NextResponse.json({ ok: data.length > 0, items: data.length });
}

// ek hi jagah se reply nikle — cards na hon toh 👇 apne aap hat jaaye
function say(reply: string, cards: Jean[], intent: Intent | null) {
  return NextResponse.json({ reply: cards.length ? reply : stripPointer(reply), cards, intent });
}

export async function POST(req: Request) {
  try {
    const { message, prevIntent, history, shownKeys, lastCards, lastBotHadCards } = await req.json();
    if (!message) return NextResponse.json({ error: "empty" }, { status: 400 });

    const prev: Intent | null = prevIntent ?? null;
    const prevCards: Jean[] = Array.isArray(lastCards) ? lastCards : [];
    const hadCards = !!lastBotHadCards && prevCards.length > 0;
    const chatHistory: { role: string; text: string }[] = history || [];
    const alreadyShown: string[] = Array.isArray(shownKeys) ? shownKeys.slice(-60) : [];

    const historyLines = chatHistory
      .slice(-6)
      .map((h) => `${h.role === "user" ? "Customer" : "John DV"}: ${h.text}`)
      .join("\n");
    const lastBotText = [...chatHistory].reverse().find((h) => h.role !== "user")?.text;

    // 1) Live catalog (cached + timeout)
    const data = await getCatalog();
    if (!data.length) {
      // sheet hi nahi mili — jhoothe numbers bolne se achha hai saaf mana karna
      return NextResponse.json({
        reply:
          "Bhaiya abhi stock list update ho rahi hai 😅\nEk minute me dobara message kijiye, turant latest maal dikha deta hoon.",
        cards: [],
        intent: prev,
      });
    }
    const summary = getCatalogSummary(data);

    // 2) Action ka faisla JS karta hai — LLM nahi. Isi se "har baat par photo"
    //    wali dikkat khatam hoti hai.
    const action = routeAction(message, lastBotText, hadCards);
    const intent = parseIntentJS(message, prev, data);

    // "ye kitne ka padega" — abhi jo cards bheje the unka hisaab do,
    // generic catalog summary nahi
    if (isLastLotQuestion(message) && prevCards.length > 0) {
      const reply = await polish(lastLotAnswer(prevCards), message, historyLines);
      return say(reply, [], prev);
    }

    // "15 pcs chahiye" / "2 lot bana do" — order ki baat, MOQ ka bhashan nahi
    const qty = parseOrderQty(message);
    if (qty && !intent.style) {
      const reply = await polish(orderAnswer(qty, prevCards), message, historyLines);
      return say(reply, [], prev);
    }

    // customer ne style number bola par wo list me hai hi nahi — seedha bata do,
    // generic catalog summary thopna confuse karta hai
    const askedStyle = taggedStyleNumber(message);
    if (askedStyle && !intent.style) {
      const draft = `Bhaiya style #${askedStyle} humari list me nahi mil raha 😅\nStyle number ek baar check kar lijiye.\nYa size aur budget bata dijiye, uske chalte hue design dikha deta hoon.`;
      const reply = await polish(draft, message, historyLines);
      return say(reply, [], prev);
    }

    // ── CHAT: greeting / thanks / mol-bhaav / FAQ — cards bilkul nahi ──
    if (action === "chat") {
      const faq = detectFAQ(message);
      let draft: string;
      if (isAffirmation(message) && prevCards.length > 0) {
        // "theek hai / haan" — cards to abhi dikhaye hi hain, ab order pe aao
        draft = ackAfterCards(prevCards);
      } else {
        draft = faq ? faq.reply : smallTalkLine(message, summary);
      }
      const reply = await polish(draft, message, historyLines);
      return say(reply, [], prev);
    }

    // ── INFO: "28x32 hai kya", "rate kya chal raha", "#17027 ka detail" ──
    if (action === "info") {
      const av = checkAvailability(data, intent);
      const draft = availabilityAnswer(data, intent, av);
      const reply = await polish(draft, message, historyLines);
      // photo sirf tab jab customer ne ek specific style number poocha ho
      const cards = intent.style ? filterAll(data, intent).slice(0, 4) : [];
      return say(reply, cards, intent);
    }

    // ── SHOW: yahi ek jagah hai jahan cards jaate hain ──────────────
    const all = filterAll(data, intent);
    const wantsMore = isMoreRequest(message);
    const fresh = all.filter((r) => !alreadyShown.includes(keyOf(r)));
    const pool = wantsMore ? fresh : all;
    let cards: Jean[] = pool.slice(0, intent.count || 5);

    // sab kuch pehle hi dikha chuke hain — wahi photo dobara mat bhejo
    if (wantsMore && cards.length === 0 && all.length > 0) {
      const reply = await polish(
        `Bhaiya is filter ke saare ${all.length} design aapko dikha chuka hoon.\nDoosra size ya thoda alag budget bataiye, naya lot nikaal deta hoon.`,
        message,
        historyLines
      );
      return say(reply, [], intent);
    }

    // kuch mila hi nahi — sach bata ke asli alternative dikhao.
    // Cards aur reply hamesha EK hi cheez ke bare me hone chahiye.
    if (cards.length === 0) {
      const av = checkAvailability(data, intent);
      const hasAlt = av.relaxed.length > 0;
      const draft = availabilityAnswer(data, intent, av, hasAlt);
      const reply = await polish(draft, message, historyLines);
      // aage ki baat isi corrected filter par chale
      return say(reply, hasAlt ? av.relaxed.slice(0, intent.count || 5) : [], av.relaxedIntent ?? intent);
    }

    // bilkul wahi lot jo abhi bheja tha — dobara wahi photo bhejna spam hai
    const sameAsLast =
      prevCards.length > 0 &&
      cards.length === prevCards.length &&
      cards.every((r, i) => keyOf(r) === keyOf(prevCards[i]));
    if (sameAsLast) {
      const wantedCheaper = /(sasta|cheap|kam\s*rate|low)/i.test(message);
      const reply = await polish(sameLotLine(cards, all.length, wantedCheaper), message, historyLines);
      return say(reply, [], intent);
    }

    const draft = showLine(data, intent, cards, all.length, checkAvailability(data, intent), wantsMore);
    const reply = await polish(draft, message, historyLines);
    return say(reply, cards, intent);
  } catch (e: any) {
    console.error("[POST]", e);
    return NextResponse.json(
      { reply: "Bhaiya server thoda busy hai 😅\nEk baar dobara message bhejiye.", cards: [] },
      { status: 200 }
    );
  }
}
