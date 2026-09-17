import alasql from "alasql";
import { Jean } from "./types";
import { visible, isLadies, getCatalogSummary, parseIntentJS } from "./intent";

// ── TEXT → SQL (sirf analytics ke liye) ───────────────────────────────
// Yahan LLM SQL likhta hai, yaani ye file iklauta jagah hai jahan LLM data
// ka faisla leta hai. Isliye teen taale lage hain:
//   1. Group A yahan tak aata hi nahi (visible() se pehle chhant jaata hai)
//   2. validateSQL() — SELECT-only, sirf `jeans` table, sirf 5 column,
//      har unknown shabd reject, LIMIT zabardasti
//   3. cards asli catalog row se banti hain, LLM ke output se kabhi nahi
// Kuch bhi gadbad ho toh null lauta do — route purana deterministic
// raasta chala lega. Customer ko error kabhi nahi dikhta.

export interface SqlAnswer {
  draft: string;
  cards: Jean[];
  sql: string;
}

export type Ask = (
  messages: { role: string; content: string }[],
  temp: number
) => Promise<string | null>;

// LLM ko sirf ye 5 column dikhte hain. `g` (A/B/Male) chhupa hua hai —
// uski jagah saaf-suthra `gender` jaata hai.
const COLUMNS = new Set(["style", "size", "rate", "gender", "img"]);

// inke alawa koi bhi shabd query me aaya toh query reject.
// (isi se DROP / INTO FILE / ATTACH / UNION / PRAGMA sab apne aap block hain)
const KEYWORDS = new Set([
  "select", "from", "jeans", "where", "group", "by", "order", "having",
  "limit", "offset", "as", "distinct", "asc", "desc",
  "and", "or", "not", "in", "between", "like", "is", "null", "true", "false",
  "case", "when", "then", "else", "end",
  "count", "sum", "avg", "min", "max", "round", "abs", "upper", "lower", "length",
]);

const MAX_ROWS = 200;
const MAX_SQL_LEN = 600;

// ── in-memory table (catalog cache ke upar) ───────────────────────────
interface Row {
  style: string;
  size: string;
  rate: number;
  gender: string;
  img: string;
}

function toRows(data: Jean[]): Row[] {
  return visible(data).map((r) => ({
    style: String(r.s ?? ""),
    size: String(r.size || "").toUpperCase(),
    rate: Number(r.rate),
    gender: isLadies(r) ? "Ladies" : "Male",
    img: r.img || "",
  }));
}

let db: alasql.Database | null = null;
let boundTo: Jean[] | null = null;

// ek hi database reuse hota hai. Catalog cache 5 min me ek baar badalta hai,
// tab reference badal jaata hai — usi par rows dobara bhar dete hain.
function database(data: Jean[]): alasql.Database {
  if (!db) {
    db = new alasql.Database("johndv");
    db.exec("CREATE TABLE jeans (style STRING, size STRING, rate NUMBER, gender STRING, img STRING)");
  }
  if (boundTo !== data) {
    (db.tables.jeans as { data: Row[] }).data = toRows(data);
    boundTo = data;
  }
  return db;
}

// ── kya ye sawaal SQL wala hai? ───────────────────────────────────────
// Sirf ginti/tulna wale sawaal. "28x32 dikhao" jaisa normal kaam purane
// regex filter ke paas hi rehna chahiye.
const AGG =
  /(sabse\s*(sasta|sasti|sast|mehng|costly|zyada|jyada|kam|acha|achha)|cheapest|costliest|highest|lowest|maximum|minimum\s*rate|average|avg\b|औसत|total\s*(kitne|kitna|count|pcs|piece|style|item|maal)|kitne\s*(style|design|piece|pcs|item|maal|variety|option|colour|color)|kitni\s*(variety|design|quality)|how\s*many|\bcount\b|ginti|size\s*wise|sizewise|gender\s*wise|breakdown|kis\s*size\s*me|kaun\s*se\s*size\s*me)/i;

// MOQ wale FAQ me bhi "kitne piece" aata hai. Farq ye hai ki MOQ ka sawaal
// KHAREEDNE ka hai ("minimum kitne piece lena padega") aur SQL ka sawaal
// STOCK ka ("gents me kitne pcs hain"). Order wale shabd dikhein toh FAQ jeeta.
const ORDER_WORDS = /(moq|minimum|min\.?\s*order|lena|lene|leni|order|lot|single|retail|khareed|mangwa)/i;

export function isAnalyticalQuestion(text: string, isFaq = false): boolean {
  const t = String(text || "").toLowerCase().replace(/[×✕]/g, "x");
  if (!AGG.test(t)) return false;
  if (isFaq && ORDER_WORDS.test(t)) return false;
  return true;
}

// SHOW_VERB me "design", "list", "option" bhi hain — isliye "kitne design hain"
// jaisa saaf ginti ka sawaal bhi routeAction se "show" ban jaata hai. Aise
// sawaal ka jawaab photo nahi, ginti hai. Par "kitne design dikhao" me customer
// ne khud photo maanga hai — wahan purana card wala raasta hi chalega.
const EXPLICIT_SHOW = /(dikha|bhej|photo|pic\b|pics|image|tasveer|send|show\b|sample)/i;

export function isCountQuestion(text: string): boolean {
  const t = String(text || "").toLowerCase();
  if (EXPLICIT_SHOW.test(t)) return false;
  return /(kitne|kitni|kitna|how\s*many|\bcount\b|ginti|\btotal\b|average|avg\b|औसत)/i.test(t);
}

// ── TEMPLATE SQL (LLM ke bina) ────────────────────────────────────────
// Groq ka free model itna pakka nahi hai — wahi sawaal par kabhi COUNT(*)
// likhta hai, kabhi COUNT(DISTINCT style). Isliye rozmarra ke sawaal LLM ke
// paas jaate hi nahi: WHERE parseIntentJS se banta hai (wahi purana source of
// truth) aur SELECT yahan fix hai. LLM sirf ajeeb/naye sawaal ke liye bachta hai.

function whereFrom(text: string, data: Jean[]): string {
  // Dhyan: prev intent nahi bhejte. "kitne style hain" par 3 message purana
  // 28X32 chipak jaaye toh ginti jhoothi ho jaayegi.
  const it = parseIntentJS(text, null, data);
  const parts: string[] = [];
  if (it.gender) parts.push(`gender = '${it.gender === "male" ? "Male" : "Ladies"}'`);
  if (it.size && /^\d{2}X\d{2}$/.test(it.size)) parts.push(`size = '${it.size}'`);
  if (it.rateMin != null) parts.push(`rate >= ${Math.round(it.rateMin)}`);
  // 9999 asli budget nahi hai — "sasta" ka sentinel hai (dekho intent.ts).
  // Baaki codebase bhi `rateMax < 9999` se hi asli budget maanta hai.
  if (it.rateMax != null && it.rateMax < 9999) parts.push(`rate <= ${Math.round(it.rateMax)}`);
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

export function templateSQL(text: string, data: Jean[]): string | null {
  const t = String(text || "").toLowerCase().replace(/[×✕]/g, "x");
  const w = whereFrom(text, data);

  // "kis size me sabse zyada" / "size wise breakdown"
  if (/(kis|kaun\w*)\s*se?\s*size|size\s*wise|sizewise|har\s*size/.test(t))
    return `SELECT size, COUNT(*) AS pcs FROM jeans${w} GROUP BY size ORDER BY pcs DESC LIMIT 4`;

  // "average rate kya chal raha"
  if (/(average|avg\b|औसत)/.test(t))
    return `SELECT ROUND(AVG(rate)) AS avg_rate FROM jeans${w} LIMIT 1`;

  // "sabse sasta / sabse mehnga kaunsa"
  if (/(sabse\s*(sasta|sasti|sast|kam)|cheapest|lowest)/.test(t))
    return `SELECT style, size, rate FROM jeans${w} ORDER BY rate ASC LIMIT 1`;
  if (/(sabse\s*(mehng|costly|zyada\s*rate)|costliest|highest\s*rate)/.test(t))
    return `SELECT style, size, rate FROM jeans${w} ORDER BY rate DESC LIMIT 1`;

  // "kitne style/design hain" — ek style ke kai size hote hain, isliye DISTINCT
  if (/(kitne|kitni|how\s*many|total)\s*\w*\s*(style|design|variety|article)/.test(t))
    return `SELECT COUNT(DISTINCT style) AS styles FROM jeans${w} LIMIT 1`;

  // "kitne pcs / piece / maal hain" — yahan har row ek piece hai
  if (/(kitne|kitni|kitna|how\s*many|total|ginti|count)/.test(t))
    return `SELECT COUNT(*) AS pcs FROM jeans${w} LIMIT 1`;

  return null;
}

// ── prompt ────────────────────────────────────────────────────────────
function sqlPrompt(data: Jean[]): string {
  const s = getCatalogSummary(data);
  return `Tu ek SQL generator hai. User ka sawaal padh ke SIRF ek SELECT query likh.

TABLE: jeans
  style   TEXT    -- style/design number, jaise '1841'
  size    TEXT    -- hamesha 'WAISTxLENGTH' uppercase format, jaise '28X32'
  rate    NUMBER  -- ek piece ka wholesale rate (rupees)
  gender  TEXT    -- sirf 'Male' ya 'Ladies'
  img     TEXT    -- photo id

ASLI DATA (isi ke andar rehna):
  available sizes: ${s.allSizes.join(", ") || "koi nahi"}
  Male rate range: ${s.maleMinRate} se ${s.maleMaxRate}
  Ladies rate range: ${s.bMinRate} se ${s.bMaxRate}

NIYAM (todna mana hai):
- Sirf SELECT. INSERT/UPDATE/DELETE/DROP/ATTACH/INTO/UNION bilkul nahi.
- Sirf jeans table. Koi JOIN, koi subquery nahi.
- Sirf upar likhe 5 column. Naya column mat bana.
- Har aggregate ko AS se naam do: COUNT(*) AS pcs, ROUND(AVG(rate)) AS avg_rate.
- Hamesha LIMIT lagao, ${MAX_ROWS} se zyada nahi.
- Size ka match exact string ('28X32') ya LIKE '28X%' se karo.
- gender sirf 'Male' ya 'Ladies'.
- Sirf query likh. Koi explanation nahi, koi markdown nahi, koi semicolon nahi.

MISAAL:
Q: 400 se neeche kitne design hain
A: SELECT COUNT(*) AS pcs FROM jeans WHERE rate < 400 LIMIT 1

Q: sabse sasta piece kaunsa hai
A: SELECT style, size, rate FROM jeans ORDER BY rate ASC LIMIT 1

Q: kaun se size me sabse zyada maal hai
A: SELECT size, COUNT(*) AS pcs FROM jeans GROUP BY size ORDER BY pcs DESC LIMIT 4

Q: ladies ka average rate kya chal raha
A: SELECT ROUND(AVG(rate)) AS avg_rate FROM jeans WHERE gender = 'Ladies' LIMIT 1

Q: gents me 32 waist ke kitne pcs hain
A: SELECT COUNT(*) AS pcs FROM jeans WHERE gender = 'Male' AND size LIKE '32X%' LIMIT 1`;
}

// ── validator ─────────────────────────────────────────────────────────
function sanitize(raw: string): string {
  let s = String(raw || "").trim();
  s = s.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  s = s.replace(/^(sql|query|answer|a)\s*[:\-]\s*/i, "").trim();
  // LLM kabhi kabhi do statement de deta hai — pehli hi lo, baaki kaat do
  s = s.split(";")[0].trim();
  return s.replace(/\s+/g, " ");
}

function withLimit(s: string): string {
  const m = s.match(/\blimit\s+(\d+)\s*$/i);
  if (!m) return `${s} LIMIT ${MAX_ROWS}`;
  return Number(m[1]) > MAX_ROWS ? s.replace(/\blimit\s+\d+\s*$/i, `LIMIT ${MAX_ROWS}`) : s;
}

export function validateSQL(raw: string): { sql: string } | { error: string } {
  const s = sanitize(raw);
  if (!s) return { error: "khaali" };
  if (s.length > MAX_SQL_LEN) return { error: "bahut lambi" };
  if (!/^select\s/i.test(s)) return { error: "select se shuru nahi" };
  // comment, javascript arrow, param, shell — kuch bhi ho, seedha reject
  if (/--|\/\*|\*\/|->|=>|[`$@\\;]/.test(s)) return { error: "galat character" };
  if (!/\bfrom\s+jeans\b/i.test(s)) return { error: "galat table" };

  // `... AS pcs` wale alias allowed hain, warna har aggregate reject ho jaata
  const aliases = new Set<string>();
  const aliasRe = /\bas\s+([a-z_][a-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = aliasRe.exec(s))) aliases.add(m[1].toLowerCase());

  // string literal hata do ('Male' ke M ko identifier mat samajh lena)
  const words = s.replace(/'[^']*'/g, "''").match(/[a-z_][a-z0-9_]*/gi) || [];
  for (const w of words) {
    const k = w.toLowerCase();
    if (KEYWORDS.has(k) || COLUMNS.has(k) || aliases.has(k)) continue;
    return { error: `anjaan shabd: ${w}` };
  }

  return { sql: withLimit(s) };
}

// ── result → Hinglish draft ───────────────────────────────────────────
// ek style ke kai size hote hain — isliye "183 design" aur "249 pcs" do alag
// baatein hain. Label galat hua toh customer ko jhoothi ginti chali jaati hai.
const DESIGN_KEY = /^(styles|designs|variety|articles)$/i;
const COUNT_KEY = /^(pcs|piece|pieces|n|cnt|count|total|qty|item|items)$/i;
const RATE_KEY = /(rate|price|daam|avg|average|min|max)/i;

function fmtCell(key: string, val: unknown): string | null {
  if (val === null || val === undefined || val === "") return null;
  const k = key.toLowerCase();
  if (k === "img") return null; // photo card me jaati hai, text me nahi
  if (k === "style") return `#${val}`;
  if (k === "size") return String(val).toUpperCase();
  if (k === "gender") return String(val) === "Male" ? "gents" : "ladies";
  if (DESIGN_KEY.test(k)) return `${val} design`;
  if (COUNT_KEY.test(k)) return `${val} ${Number(val) === 1 ? "pc" : "pcs"}`;
  if (RATE_KEY.test(k) && !isNaN(Number(val))) {
    const r = Math.round(Number(val));
    // sirf "₹449" likha toh LLM use "rate" samajh leta hai. Average ko average
    // hi bolna hai, warna customer ko lagega har piece isi rate ka hai.
    if (/avg|average/.test(k)) return `average rate ₹${r}`;
    if (/^min/.test(k)) return `sabse kam rate ₹${r}`;
    if (/^max/.test(k)) return `sabse zyada rate ₹${r}`;
    return `₹${r}`;
  }
  return `${k.replace(/_/g, " ")} ${val}`;
}

function describe(rows: Record<string, unknown>[], hasCards: boolean): string {
  const lines = rows
    .slice(0, 4)
    .map((r) =>
      Object.keys(r)
        .map((k) => fmtCell(k, r[k]))
        .filter(Boolean)
        .join(" — ")
    )
    .filter(Boolean);

  if (!lines.length) {
    return "Bhaiya is hisaab se abhi list me kuch nahi mil raha 😅\nSize ya budget thoda alag bataiye, turant nikaal deta hoon.";
  }

  const tail = hasCards
    ? "Aur options chahiye toh size ya budget bata dijiye."
    : rows.some((r) => "style" in r)
    ? "Bolo toh inke photo bhej dun?"
    : "Size ya budget bataiye, usi hisaab se lot bana deta hoon.";

  return [`Bhaiya abhi ki list ka hisaab ye hai:`, ...lines, tail].join("\n");
}

// SQL ne jo style|size lauta diya, wahi row asli catalog se uthao.
// Card ka data kabhi LLM ke output se nahi banta.
function cardsFor(rows: Record<string, unknown>[], data: Jean[]): Jean[] {
  if (!rows.length || rows.length > 4) return [];
  const pool = visible(data);
  const picked: Jean[] = [];
  for (const r of rows) {
    if (r.style == null || r.size == null) return [];
    const hit = pool.find(
      (j) => String(j.s) === String(r.style) && j.size === String(r.size).toUpperCase()
    );
    if (!hit || !hit.img) return [];
    picked.push(hit);
  }
  return picked;
}

// ── main ──────────────────────────────────────────────────────────────
export async function answerWithSQL(
  message: string,
  data: Jean[],
  ask: Ask
): Promise<SqlAnswer | null> {
  if (!data.length) return null;

  // 1) Pehle template — rozmarra ke 90% sawaal yahin nipat jaate hain,
  //    bina LLM ke, isliye jawaab har baar bilkul ek jaisa aata hai.
  let sql = templateSQL(message, data);
  let via = "template";

  // 2) Template me na baithe tabhi LLM se SQL maango — wo bhi validator ke peeche
  if (!sql) {
    const raw = await ask(
      [
        { role: "system", content: sqlPrompt(data) },
        { role: "user", content: `Q: ${message}\nA:` },
      ],
      0
    );
    if (!raw) return null; // Groq band hai — purana raasta chalega

    const v = validateSQL(raw);
    if ("error" in v) {
      console.warn("[sql] reject:", v.error, "|", raw.slice(0, 120));
      return null;
    }
    sql = v.sql;
    via = "llm";
  }
  const v = { sql };
  console.info("[sql]", via, "|", sql);

  let out: unknown;
  try {
    out = database(data).exec(v.sql);
  } catch (e) {
    console.warn("[sql] run fail:", v.sql, e);
    return null;
  }
  if (!Array.isArray(out)) return null;

  let rows = out.filter((r) => r && typeof r === "object") as Record<string, unknown>[];
  // MIN/AVG khali set par null lauta dete hain — usko "kuch nahi mila" maano
  rows = rows.filter((r) => Object.values(r).some((v2) => v2 !== null && v2 !== undefined));

  const cards = cardsFor(rows, data);
  return { draft: describe(rows, cards.length > 0), cards, sql: v.sql };
}
