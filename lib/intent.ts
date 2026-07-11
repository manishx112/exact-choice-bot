import { Jean, Intent } from "./types";

// ── raw Apps Script row → clean Jean ───────────────────────────
export function normalize(rows: any[]): Jean[] {
  return rows
    .map((r) => {
      const idMatch = String(r["Image Upload"] || "").match(/[-\w]{25,}/);
      const stockRaw = r["Stock"];
      return {
        s: r["Style No."],
        size: String(r["Size"] || "").toUpperCase(),
        rate: Number(r["Rate"]),
        g: r["Group A & B"],
        stock: stockRaw === "" || stockRaw == null ? null : Number(stockRaw),
        img: idMatch ? idMatch[0] : "",
      } as Jean;
    })
    .filter((r) => r.rate && r.size);
}

// ── greeting/small-talk detector (in nu product list na dikhao) ──
export function isGreeting(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
  if (!t) return false;
  if (/^(h+i+|h+e+y+|h+e+l+o+w?|h+l+o+|y+o+)$/.test(t)) return true;
  const GREETINGS = new Set([
    "sat sri akaal",
    "sat sri akal",
    "sasriakal",
    "satsriakal",
    "namaste",
    "namaskar",
    "good morning",
    "good afternoon",
    "good evening",
    "good night",
    "how are you",
    "how r u",
    "hru",
    "how you doing",
    "howdy",
    "whats up",
    "wassup",
    "sup",
    "kaise ho",
    "kaisa hai",
    "kya haal hai",
    "kese ho",
  ]);
  return GREETINGS.has(t);
}

// ── thanks/appreciation detector (in nu v product list na dikhao) ──
export function isAppreciation(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
  if (!t) return false;
  const core = t
    .replace(/\b(paaji|ji|bro|yaar|bhai|dude|sir)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const PATTERNS = [
    /^thanks?$/,
    /^thank\s*you+$/,
    /^thnx$/,
    /^tqu?$/,
    /^ty$/,
    /^shabash$/,
    /^shukriya$/,
    /^good\s*job$/,
    /^good\s*work$/,
    /^well\s*done$/,
    /^nice(\s*one)?$/,
    /^great$/,
    /^awesome$/,
    /^perfect$/,
    /^cool$/,
    /^super$/,
    /^mast$/,
    /^badhiya$/,
    /^vadhiya$/,
    /^changa(\s*hai)?$/,
    /^ok(ay)?\s*thanks?$/,
    /^good$/,
  ];
  return PATTERNS.some((re) => re.test(core));
}

// ── product-intent gate (isse kam kuch bhi ho toh chit-chat samjho) ──
// Whitelist ke bharose na raho — sirf tabhi product list dikhao jab
// message vich actually size/rate/stock jeha koi signal ho.
export function hasProductIntent(text: string): boolean {
  const t = text.toLowerCase().replace(/[×✕]/g, "x");
  if (/\d{2}\s*[x*]\s*\d{2}/.test(t)) return true; // "28x32" size pattern
  if (/\d{3,4}/.test(t)) return true; // koi bhi 3-4 digit number = likely rate
  if (
    /(stock|available|ready|maal|jeans|pant|denim|dikha|chahide|chahiye|price|rate|size|sasta|mehnga|range|pcs|piece)/.test(
      t
    )
  )
    return true;
  return false;
}

// ── JS intent parser (Groq na ho toh yahi chalega) ───────────
// prev diya toh usi conversation ka context maano — sirf jo field current
// message mein explicitly mention hui hai wahi overwrite hogi, baaki prev se
// carry forward hongi (jaise "sirf 2 pcs dikhao" purane size/rate/gender rakhega).
export function parseIntentJS(text: string, prev?: Intent | null): Intent {
  const t = text.toLowerCase().replace(/[×✕]/g, "x");
  const it: Intent = prev
    ? { ...prev }
    : { size: null, rateMin: null, rateMax: null, count: 5, inStock: false, gender: null };

  if (/(male|men|mens|men's|boy|boys|gents|munde|mundeya|ladke|ladko|ladka)/.test(t)) it.gender = "male";
  else if (/(female|women|womens|women's|girl|girls|ladies|ladki|ladkiyo|kudi|kudiyan)/.test(t)) it.gender = "female";

  const sizeM = t.match(/(\d{2})\s*[x*]\s*(\d{2})/);
  if (sizeM) it.size = `${sizeM[1]}X${sizeM[2]}`;

  if (/(stock|available|ready|hai kya|maal ready)/.test(t)) it.inStock = true;

  const cM = t.match(/(\d{1,2})\s*(pcs|piece|pieces|maal|jeans|dikha)/);
  if (cM) it.count = Math.min(20, parseInt(cM[1]));

  let rateText = t;
  if (sizeM) rateText = rateText.replace(sizeM[0], " ");
  if (cM) rateText = rateText.replace(cM[0], " ");
  const nums = (rateText.match(/\d{3,4}/g) || []).map(Number).filter((n) => n >= 100 && n <= 2000);
  const sasta = !nums.length && /sasta/.test(t);

  // rate ka koi naya signal mila tabhi purani range replace karo, warna
  // pichle turn wali rate range as-is carry forward hogi.
  if (nums.length || sasta) {
    it.rateMin = null;
    it.rateMax = null;
    if (/(se|to|-).*(tak)/.test(t) && nums.length >= 2) {
      it.rateMin = Math.min(nums[0], nums[1]);
      it.rateMax = Math.max(nums[0], nums[1]);
    } else if (/(under|niche|neeche|kam|max|tak|ke andar|sasta)/.test(t) && nums.length) {
      it.rateMax = nums[0];
    } else if (/(upar|zyada|min|above|mehnga)/.test(t) && nums.length) {
      it.rateMin = nums[0];
    } else if (nums.length) {
      it.rateMin = nums[0] - 25;   // "300 range" → ±25 band
      it.rateMax = nums[0] + 25;
    }
    if (sasta) it.rateMax = 9999; // sort asc handle karega
  }

  return it;
}

// ── deterministic filter (SOURCE OF TRUTH — LLM nahi) ──────────
export function filterData(data: Jean[], it: Intent): Jean[] {
  let rows = data.filter((r) => r.g !== "A"); // Group A hamesha skip (female, but never show)
  // Male user maange toh sirf "Male" group, warna default Group B (female)
  rows = it.gender === "male" ? rows.filter((r) => r.g === "Male") : rows.filter((r) => r.g !== "Male");
  if (it.size) rows = rows.filter((r) => r.size === it.size);
  if (it.rateMin != null) rows = rows.filter((r) => r.rate >= it.rateMin!);
  if (it.rateMax != null && it.rateMax < 9999) rows = rows.filter((r) => r.rate <= it.rateMax!);
  if (it.inStock) rows = rows.filter((r) => r.stock != null && r.stock > 0);
  rows.sort((a, b) => a.rate - b.rate);
  return rows.slice(0, it.count);
}

// ── Punjabi persona wrapper (sirf text, data nahi) ─────────────
export function personaLine(it: Intent, n: number): string {
  if (n === 0)
    return "Oye paaji 😅 is size/rate vich abhi kuch nahi mil reha. Thoda range badhaao ya doosra size try karo.";
  const sizeTxt = it.size ? it.size : "sab sizes";
  const rateTxt =
    it.rateMin != null && it.rateMax != null && it.rateMax < 9999
      ? `₹${it.rateMin}–₹${it.rateMax}`
      : it.rateMax != null && it.rateMax < 9999
      ? `₹${it.rateMax} tak`
      : it.rateMin != null
      ? `₹${it.rateMin}+`
      : "har rate";
  return `Balle balle! 🔥 ${sizeTxt} vich ${rateTxt} de ${n} maal ready ne, paaji 👇`;
}
