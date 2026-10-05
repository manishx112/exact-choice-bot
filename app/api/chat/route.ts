import { NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { answerWithSQL, isAnalyticalQuestion, isCountQuestion } from "@/lib/sql";
import { Intent, Jean } from "@/lib/types";

export const dynamic = "force-dynamic";

// APPS_SCRIPT_URL me comma se kai URL de sakte ho — order hi priority hai.
// Ek deployment 404 "Page not found" de (aisa hua hai, phir khud theek bhi ho
// gaya) toh agla URL. Purana script "Image Upload" column deta hai, naya
// "Image Kit Link" — normalize() dono samajhta hai.
const SCRIPT_URLS = (process.env.APPS_SCRIPT_URL || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
// ── LLM providers: pehle Gemini (list ka har model baari baari), phir Groq ──
// Dono free tier par hain aur dono OpenAI-compatible hain, isliye ek hi
// request format dono me chalta hai.
//   Gemini — free tier me HAR MODEL ka quota alag hai, isliye ek model 429/404
//            de toh list ka agla model try karo
//   Groq   — aakhri sahara: tez (~1 sec), 1000 request/din, 8000 token/min
type Msg = { role: string; content: string };

interface Provider {
  name: string;
  url: string;
  key: string | undefined;
  model: string;
  extra: Record<string, unknown>;
}

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

// List ka order hi priority hai. Test (Oct 2026, free key): 3.5-flash-lite ~1.1s,
// 3.1-flash-lite ~2.5s. Free tier = 15 request/min HAR MODEL. 1.5 / 2.0 / 2.5 band (404).
// "-latest" naam mat daalna — gemini-flash-lite-latest asal me 3.5-flash-lite hi hai,
// usi ka quota khata hai, toh backup ka koi fayda nahi (429 me "model:" dekh lo).
// Dhyan: "flash-lite" hi rakho. gemini-3.5-flash jaise bade model 8-12 sec lete hain,
// aur thinking model 400 token soch me uda ke reply 5 shabd par kaat dete hain.
const GEMINI_MODELS = (
  process.env.GEMINI_MODELS ||
  process.env.GEMINI_MODEL ||
  "gemini-3.5-flash-lite,gemini-3.1-flash-lite"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

const GEMINIS: Provider[] = GEMINI_MODELS.map((model) => ({
  name: `gemini:${model}`,
  url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  key: process.env.GEMINI_API_KEY,
  model,
  extra: {},
}));

const GROQ: Provider = {
  name: "groq",
  url: "https://api.groq.com/openai/v1/chat/completions",
  key: process.env.GROQ_API_KEY,
  model: GROQ_MODEL,
  // gpt-oss apni "reasoning" bhi isi token budget me likhta hai — bina
  // iske 220 token soch me nikal jaate the aur reply beech me kat jaati thi
  extra: /gpt-oss/.test(GROQ_MODEL) ? { reasoning_effort: "low" } : {},
};

type Attempt = { text: string | null; status: number; retryAfter: number };

// Kharab model ko har message par dobara mat aazmao — har baar customer ka
// aadha-ek second jaata hai.
//   404 = model hai hi nahi (band / galat naam) → server restart tak skip
//   429 = is model ka quota khatam → 60 sec skip
//   503 = Google par bheed → 30 sec skip
const benchedUntil = new Map<string, number>();

function isBenched(p: Provider): boolean {
  return (benchedUntil.get(p.name) ?? 0) > Date.now();
}

function bench(p: Provider, status: number) {
  const ms = status === 404 ? Infinity : status === 429 ? 60_000 : status === 503 ? 30_000 : 0;
  if (!ms) return;
  benchedUntil.set(p.name, Date.now() + ms);
  console.warn(`[llm] ${p.name} skip ${ms === Infinity ? "(restart tak)" : `${ms / 1000} sec`} — http ${status}`);
}

async function callProvider(p: Provider, messages: Msg[], temp: number, signal: AbortSignal): Promise<Attempt> {
  try {
    const res = await fetch(p.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.key}` },
      body: JSON.stringify({ model: p.model, temperature: temp, max_tokens: 400, messages, ...p.extra }),
      signal,
    });
    const j = await res.json().catch(() => null);
    const text = res.ok ? j?.choices?.[0]?.message?.content?.trim() || null : null;
    if (!text) {
      // Pehle yahan failure chupchaap null ban jaata tha — Groq model decommission
      // (404) hafton tak kisi ko pata nahi chala. Ab har failure log me dikhega.
      const why = res.ok ? `empty reply (finish=${j?.choices?.[0]?.finish_reason})` : j?.error?.message || j?.[0]?.error?.message || "no body";
      console.error(`[${p.name}] http ${res.status}:`, why);
    }
    return { text, status: res.status, retryAfter: Number(res.headers.get("retry-after")) || 1 };
  } catch (e) {
    // timeout par poora DOMException dump log bhar deta tha — ek line kaafi hai
    console.error(`[${p.name}]`, e instanceof Error && e.name === "TimeoutError" ? "timeout" : e);
    return { text: null, status: 0, retryAfter: 1 };
  }
}

// customer 8 sec se zyada wait kare, usse achha deterministic reply chala do.
// Saare attempt milke bhi isse lamba nahi.
const LLM_DEADLINE_MS = 8000;
const GEMINI_TRY_MS = 3000; // ek Gemini model par isse zyada nahi — agle ko mauka do
// Groq aam taur par ~1 sec, par kabhi 2.5 sec se upar — Gemini ye waqt kha na jaaye
const GROQ_RESERVE_MS = 3000;

async function llm(messages: Msg[], temp: number): Promise<string | null> {
  const start = Date.now();
  const deadline = AbortSignal.timeout(LLM_DEADLINE_MS);
  const left = () => LLM_DEADLINE_MS - (Date.now() - start);
  const reserve = GROQ.key ? GROQ_RESERVE_MS : 0;
  const failed: string[] = [];
  const answered = (p: Provider, text: string) => {
    if (failed.length) console.info(`[llm] ${failed.join(" → ")} fail, ${p.name} se jawaab aaya`);
    return text;
  };

  // 1) Gemini — list ka har model baari baari. Ek fail (404 band, 429 quota,
  //    503 busy, timeout) toh agla model.
  for (const p of GEMINIS) {
    if (!p.key || isBenched(p)) continue;
    const budget = Math.min(GEMINI_TRY_MS, left() - reserve);
    if (budget < 800) break; // itne me reply nahi aata — Groq ka waqt bachao
    const r = await callProvider(p, messages, temp, AbortSignal.any([deadline, AbortSignal.timeout(budget)]));
    if (r.text) return answered(p, r.text);
    bench(p, r.status);
    failed.push(p.name);
  }

  // 2) Gemini ka koi model nahi chala — Groq
  if (GROQ.key && !deadline.aborted) {
    let r = await callProvider(GROQ, messages, temp, deadline);
    // Groq ka 429 1-3 sec me khul jaata hai — waqt bacha ho toh ek aakhri try
    const wait = Math.min(r.retryAfter, 3) * 1000;
    if (!r.text && r.status === 429 && left() > wait + 1000) {
      await new Promise((res) => setTimeout(res, wait));
      r = await callProvider(GROQ, messages, temp, deadline);
    }
    if (r.text) return answered(GROQ, r.text);
    failed.push(GROQ.name);
  }

  if (failed.length) console.warn(`[llm] sab fail (${failed.join(" → ")}) — draft hi jaayega`);
  return null;
}

// ── catalog cache ──────────────────────────────────────────────────
// Apps Script khud 5-30 sec leta hai, aur ek saath 2-3 hit karo toh queue
// lag ke 30+ sec ho jaata hai (ya Google 404 de deta hai). Isliye:
//   • 5 min TTL (sheet din me ek-do baar hi badalti hai)
//   • stale-while-revalidate — customer purana data turant paata hai
//   • in-flight dedup — ek time par sirf ek hi fetch jaayega
//   • disk snapshot — restart ke baad bhi purana data turant (neeche)
let catalogCache: { at: number; data: Jean[] } | null = null;
let inFlight: Promise<Jean[]> | null = null;
const CATALOG_TTL = 5 * 60_000;

// fail hua URL 10 min skip — 404 wala deployment bhi 30 sec laga ke mana karta
// hai, har refresh par wo intezaar dobara mat karo
const urlDownUntil = new Map<string, number>();
const URL_DOWN_MS = 10 * 60_000;

async function fetchCatalog(): Promise<Jean[]> {
  try {
    const up = SCRIPT_URLS.filter((u) => (urlDownUntil.get(u) ?? 0) <= Date.now());
    // sab skip list me hain — phir bhi sabko try karo, kuch na karne se achha
    for (const url of up.length ? up : SCRIPT_URLS) {
      const tag = url.match(/\/s\/([^/]{10})/)?.[1] ?? url.slice(-12);
      try {
        // naya script 17-34 sec leta hai — 20 sec par kaat dete the toh cache
        // kabhi bharta hi nahi tha aur har customer ko "update ho rahi hai"
        const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`http ${res.status}`);
        const j = await res.json();
        const data = normalize(j.data || []);
        if (!data.length) throw new Error("khaali data");
        urlDownUntil.delete(url);
        catalogCache = { at: Date.now(), data };
        writeFile(SNAPSHOT, JSON.stringify(data)).catch(() => {});
        return data;
      } catch (e) {
        urlDownUntil.set(url, Date.now() + URL_DOWN_MS);
        const why = e instanceof Error ? (e.name === "TimeoutError" ? "timeout" : e.message) : String(e);
        console.error(`[catalog] ${tag}… fail (${why}) — 10 min skip`);
      }
    }
    return catalogCache?.data || []; // sheet down — purana data hi sahi
  } finally {
    inFlight = null;
  }
}

// Aakhri achha catalog disk par bhi. Google kabhi kabhi DONO script par ek saath
// 404 / timeout deta hai — server restart ke theek baad aisa hua toh bot ke paas
// kuch nahi hota tha. Ab purane data se chalta hai aur refresh peeche chalta hai.
// (Vercel jaise serverless par /tmp har instance ka alag hai — wahan madad kam hai.)
const SNAPSHOT = join(tmpdir(), "johndv-catalog.json");
let snapshotTried = false;

async function loadSnapshot() {
  if (snapshotTried) return;
  snapshotTried = true;
  try {
    const data = JSON.parse(await readFile(SNAPSHOT, "utf8"));
    // at: 0 = turant "purana" — pehli hi request par taaza fetch shuru ho jaata hai
    if (Array.isArray(data) && data.length && !catalogCache) catalogCache = { at: 0, data };
  } catch {
    // snapshot nahi hai — pehli baar chal raha hai
  }
}

// bilkul pehli baar, haath me koi data nahi, aur dono URL atke — customer ko
// 2 min spinner mat dikhao. Itne me na aaye toh "update ho rahi hai" bol do,
// fetch peeche chalta rahega aur agla message cache se jaayega.
const COLD_WAIT_MS = 25_000;

async function getCatalog(): Promise<Jean[]> {
  if (!catalogCache) await loadSnapshot();
  const fresh = catalogCache && Date.now() - catalogCache.at < CATALOG_TTL;
  if (fresh) return catalogCache!.data;

  const job = inFlight || (inFlight = fetchCatalog());
  // purana data haath me hai toh customer ko intezaar mat karao —
  // refresh background me chalta rahega
  if (catalogCache) {
    job.catch(() => {});
    return catalogCache.data;
  }
  return Promise.race([job, new Promise<Jean[]>((r) => setTimeout(() => r([]), COLD_WAIT_MS))]);
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
  const out = await llm([{ role: "system", content: sys }, { role: "user", content: user }], 0.55);
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

    // ── ANALYTICS (text → SQL) ──────────────────────────────────────
    // "kitne style hain", "kis size me sabse zyada maal", "ladies ka average
    // rate" — ye ginti wale sawaal regex filter kabhi nahi bana sakta. Sirf
    // yahin LLM SQL likhta hai, aur wo bhi SELECT-only validator ke peeche.
    // Query reject/fail hui toh chupchaap neeche purana raasta chalta hai.
    // Dhyan: "show" ko haath nahi lagaya — "sabse sasta dikhao" par purani card
    // wali chaal hi sahi hai. Sirf saaf ginti ("kitne design hain", bina photo
    // maange) show se cheen li jaati hai, kyunki uska jawaab number hai.
    if (
      !intent.style &&
      isAnalyticalQuestion(message, !!detectFAQ(message)) &&
      (action !== "show" || isCountQuestion(message))
    ) {
      const ans = await answerWithSQL(message, data, llm);
      if (ans) {
        const reply = await polish(ans.draft, message, historyLines);
        // filter wahi purana rehne do — ginti ka sawaal filter nahi badalta
        return say(reply, ans.cards, prev);
      }
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
