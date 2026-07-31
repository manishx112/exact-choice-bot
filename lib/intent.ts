import { Jean, Intent } from "./types";

// ── raw Apps Script row → clean Jean ───────────────────────────
export function normalize(rows: any[]): Jean[] {
  return rows
    .map((r) => {
      const idMatch = String(r["Image Upload"] || "").match(/[-\w]{25,}/);
      // Sheet me filhal "Stock" column hai hi nahi. Blank = UNKNOWN, "out of
      // stock" NAHI — warna stock filter poora catalog kha jaata hai.
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

// Group A kabhi customer ko nahi dikhta — har calculation isi list pe ho,
// warna bot "114 items hain" bolega aur dikhayega kuch aur.
export function visible(data: Jean[]): Jean[] {
  return data.filter((r) => r.g !== "A");
}

export function isLadies(r: Jean): boolean {
  return r.g !== "Male";
}

// har row ka unique pehchaan — dobara wahi card na bheje isliye
export function keyOf(r: Jean): string {
  return `${r.s}|${r.size}`;
}

// ── size-wise stats (kitne pcs, kaunsa rate band) ──────────────────
export interface SizeStat {
  size: string;
  count: number;
  min: number;
  max: number;
}

export function sizeStats(rows: Jean[]): SizeStat[] {
  const map = new Map<string, number[]>();
  rows.forEach((r) => {
    const arr = map.get(r.size) || [];
    arr.push(r.rate);
    map.set(r.size, arr);
  });
  return Array.from(map.entries())
    .map(([size, rates]) => ({
      size,
      count: rates.length,
      min: Math.min(...rates),
      max: Math.max(...rates),
    }))
    .sort((a, b) => b.count - a.count);
}

// ── Catalog Data Summary for LLM Context ───────────────────────────
export function getCatalogSummary(data: Jean[]) {
  const rows = visible(data);
  const maleItems = rows.filter((r) => r.g === "Male");
  const bItems = rows.filter(isLadies);
  const maleRates = maleItems.map((r) => r.rate).filter(Boolean);
  const bRates = bItems.map((r) => r.rate).filter(Boolean);
  const maleStats = sizeStats(maleItems);
  const bStats = sizeStats(bItems);

  return {
    totalItems: rows.length,
    maleCount: maleItems.length,
    maleMinRate: maleRates.length > 0 ? Math.min(...maleRates) : 380,
    maleMaxRate: maleRates.length > 0 ? Math.max(...maleRates) : 500,
    maleSizes: maleStats.map((s) => s.size).join(", "),
    maleStats,
    bCount: bItems.length,
    bMinRate: bRates.length > 0 ? Math.min(...bRates) : 210,
    bMaxRate: bRates.length > 0 ? Math.max(...bRates) : 410,
    bSizes: bStats.map((s) => s.size).join(", "),
    bStats,
    allSizes: sizeStats(rows).map((s) => s.size),
  };
}

// ── LLM ko dene wala REAL data block ───────────────────────────────
// Ye prompt me jaata hai taaki bot size/rate kabhi apne mann se na bole.
export function catalogFacts(data: Jean[]): string {
  const s = getCatalogSummary(data);
  const line = (st: SizeStat) => `${st.size} (${st.count} pcs, ₹${st.min}-₹${st.max})`;
  return [
    `MEN (gents jeans) — total ${s.maleCount} pcs, rate ₹${s.maleMinRate}-₹${s.maleMaxRate}`,
    `  sizes: ${s.maleStats.map(line).join(" | ") || "abhi koi nahi"}`,
    `LADIES — total ${s.bCount} pcs, rate ₹${s.bMinRate}-₹${s.bMaxRate}`,
    `  sizes: ${s.bStats.map(line).join(" | ") || "abhi koi nahi"}`,
    `AVAILABLE SIZES (sirf ye, aur koi nahi): ${s.allSizes.join(", ")}`,
  ].join("\n");
}

// ── greeting/small-talk detector (in par product list na dikhao) ──
export function isGreeting(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
  if (!t) return false;
  if (/^(h+i+|h+e+y+|h+e+l+o+w?|h+l+o+|y+o+|h+a+n+j+i+)$/.test(t)) return true;
  const GREETINGS = new Set([
    "namaste",
    "namaskar",
    "pranam",
    "ram ram",
    "radhe radhe",
    "jai shree ram",
    "haanji",
    "haan ji",
    "bhaiya",
    "hello bhaiya",
    "namaste bhaiya",
    "sat sri akaal",
    "sat sri akal",
    "good morning",
    "good afternoon",
    "good evening",
    "good night",
    "how are you",
    "how r u",
    "hru",
    "how you doing",
    "whats up",
    "wassup",
    "sup",
    "kaise ho",
    "kaisa hai",
    "kya haal hai",
    "kya haal hai bhaiya",
    "kese ho",
    "kaun",
    "kaun ho",
    "aap kaun ho",
    "tum kaun ho",
    "kya kaam karte ho",
  ]);
  return GREETINGS.has(t);
}

// ── thanks/appreciation detector (in par product list na dikhao) ──
export function isAppreciation(text: string): boolean {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
  if (!t) return false;
  const core = t
    .replace(/\b(bhaiya|bhai|boss|ji|paaji|bro|yaar|dude|sir)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const PATTERNS = [
    /^thanks?$/,
    /^thank\s*you+$/,
    /^thnx$/,
    /^tqu?$/,
    /^ty$/,
    /^dhanyawad$/,
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
    /^badiya$/,
    /^changa(\s*hai)?$/,
    /^ok(ay)?\s*thanks?$/,
    /^good$/,
    /^bye$/,
    /^ok$/,
    /^hmm+$/,
    /^achha$/,
    /^accha$/,
  ];
  return PATTERNS.some((re) => re.test(core));
}

// ── "photo/maal dikhao" ka saaf signal ─────────────────────────────
const SHOW_VERB =
  /(dikha|dikhao|dikhaiye|dikhaye|dikhado|dekhna|dekhne|dekhau|bhej\s*d|bhejo|bhej\s*de|send|show\b|photo|pic\b|pics|image|tasveer|sample|catalog|catalogue|list\b|option|design)/i;

// negotiation / rate-tol-mol — yahan card spam nahi karna
const NEGOTIATION =
  /(kam\s*kar|kam\s*ho|kam\s*karo|discount|last\s*price|final\s*(rate|price)|best\s*(rate|price)|bargain|mehnga\s*hai|jyada\s*hai|zyada\s*hai|sasta\s*kar|thoda\s*kam|me\s*de\s*d|mein\s*de\s*d|de\s*doge|dogey?|lagao|laga\s*d)/i;

const SIZE_PATTERN = /\d{2}\s*[x*×✕]\s*\d{2}/i;

// question shabd — inka matlab "batao", zaroori nahi "dikhao"
const QUESTION_WORD =
  /(kya|kaun|kaunsa|konsa|kaun\s*se|kitna|kitne|kitni|kab|kahan|kaise|kyu|hai\s*kya|available|milega|milegi|milta|hoga|hogi|\?)/i;

// ── product-intent gate (isse kam kuch bhi ho toh chit-chat samjho) ──
export function hasProductIntent(text: string): boolean {
  const t = text.toLowerCase().replace(/[×✕]/g, "x");
  if (SIZE_PATTERN.test(t)) return true;
  if (/\d{3,5}/.test(t)) return true;
  if (
    /(stock|available|ready|maal|jeans|pant|denim|dikha|chahiye|price|rate|daam|size|sasta|mehnga|range|pcs|piece|lot|wholesal|catalog|sample|gandhi nagar|tank road)/.test(
      t
    )
  )
    return true;
  return false;
}

// "aur dikhao", "next", "aur options" — pehle wale cards dobara mat bhejo.
// Dhyan: "aur sasta" / "aur mehnga" ka matlab NAYA filter hai, "aur maal" nahi.
export function isMoreRequest(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/\b(bhaiya|bhai|ji|bro|yaar|sir)\b/g, "").trim();
  // "aur sasta", "aur bada size" — ye filter badal raha hai, more request nahi
  if (/^(aur|or|kuch\s*aur)\s+(sasta|mehnga|costly|cheap|bada|chota|acha|achha|badiya|light|dark|heavy)/.test(t))
    return false;
  if (/^(aur|or|more|next|baaki|aage|next\s*wale)\s*(dikha\w*|design|option\w*|photo|maal|jeans|piece|lot)?[\s?.!]*$/.test(t))
    return true;
  return /(aur\s*(dikha|design|option|maal|jeans|photo|piece)|next\s*(wale|lot)|baaki\s*(wale|dikha)|more\s*(option|design)|new\s*design|naye?\s*design)/i.test(
    t
  );
}

// ── FAQ detector (wholesale objections / business queries) ─────────────
export function detectFAQ(text: string): { key: string; reply: string } | null {
  const t = text.toLowerCase();

  if (/(kahan|where|address|location|shop|dukaan|showroom|gandhi nagar|tank road|aana|visit|office)/.test(t)) {
    return {
      key: "location",
      reply:
        "Hamari wholesale shop Delhi me hai bhaiya — Tank Road / Gandhi Nagar, subah 10 se shaam 8 baje tak khuli rehti hai.\nAap direct aa sakte ho, ya yahin se order karke transport se manga lo.\nAapko gents chahiye ya ladies?",
    };
  }

  if (/(moq|minimum|piece|pcs|single|retail|kitne piece|lot size|kitna order|kitna lena|1 pc|ek pc)/.test(t)) {
    return {
      key: "moq",
      reply:
        "Hum sirf wholesale karte hain bhaiya, single piece retail nahi jaata.\nMinimum 1 lot = 15-20 pcs (mix size/colour) hota hai.\nAapka size aur budget bata dijiye, usi hisaab se lot bana deta hoon.",
    };
  }

  if (/(cod|cash on delivery|payment|pay|online|gpay|phonepe|token|advance|paisa|paise)/.test(t)) {
    return {
      key: "cod",
      reply:
        "Payment simple hai bhaiya — UPI/GPay/PhonePe ya bank transfer par same-day dispatch.\nNaye customer ke liye thoda token advance + baaki delivery par (partial COD) bhi chalta hai.\nKaunsa size aur rate range ka lot bana dun?",
    };
  }

  if (/(delivery|deliver|shipping|transport|courier|kab tak|kitne din|pan india|bhej|pohanchega|pahunchega)/.test(t)) {
    return {
      key: "shipping",
      reply:
        "Poore India me transport aur courier dono se bhejte hain bhaiya.\nDelhi se nikalne ke baad 2-4 din me aapke city pahunch jaata hai, packing full safe.\nAap kis city se ho? Us hisaab se transport bata deta hoon.",
    };
  }

  if (/(quality|fabric|cloth|washing|stretch|stitching|guarantee|fit|material|kapda)/.test(t)) {
    return {
      key: "quality",
      reply:
        "Kapda power-stretch denim hai bhaiya, heavy wash ke saath — colour aur fitting dono tikte hain.\nStitching ya colour ki koi dikkat aayi toh replacement milta hai.\nAapko budget lot chahiye ya premium heavy stretch?",
    };
  }

  if (/(discount|margin|bulk order|wholesal rate|scheme)/.test(t)) {
    return {
      key: "discount",
      reply:
        "Rate already factory-direct hai bhaiya, isi me aapko counter par 40-60% margin nikal jaata hai.\n100+ pcs le rahe ho toh scheme wala extra discount bhi ban jaata hai.\nBatao kitne pcs ka plan hai?",
    };
  }

  if (/(number|contact|phone|call|mobile|whatsapp)/.test(t)) {
    return {
      key: "contact",
      reply:
        "Yahin chat par bata dijiye bhaiya, live stock turant dikha deta hoon.\nBulk order final karna ho toh wholesale desk ka number bhi share kar dunga.\nAbhi kaunsa size dekhna hai?",
    };
  }

  return null;
}

// ── affirmation / confirmation detector ("ha dikha do", "haan", "ok dikhao") ──
export function isAffirmation(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^(ha+|haan+|haa|yes|ok+ay?|sure|dikha\s*do|dikhao|dikhaye|bhej\s*do|theek\s*hai|sahi\s*hai|badiya|ha\s*dikha\s*do|haan\s*dikha\s*do|bhaiya\s*dikha\s*do|dikha\s*do\s*bhaiya)$/i.test(
      t
    ) || /(ha\s*dikha\s*do|haan\s*dikha|dikha\s*do|haan\s*bhaiya|dikhao|bhej\s*do|sahi\s*hai|theek\s*hai)/i.test(t)
  );
}

// pichhle bot message me OFFER tha kya ("dikhaun?") — tabhi "haan" = show.
// "👇" ko yahan mat jodo: wo har card-wale reply me hota hai, jisse customer ka
// "theek hai" bhi naya card-dump trigger kar deta tha.
export function botOfferedToShow(lastBotText: string | undefined): boolean {
  if (!lastBotText) return false;
  return /(dikhaun|dikhau|dikha\s*dun|dikha\s*du|bhej\s*dun|bhej\s*du|dekhein|dekhoge|dikhaye\s*\?)/i.test(lastBotText);
}

// ── ACTION ROUTER (deterministic — LLM ke bharose card mat dikhana) ──
// "chat" = sirf baat, "info" = data se seedha jawaab, "show" = product cards
export type Action = "chat" | "info" | "show";

export function routeAction(text: string, lastBotText?: string, lastBotHadCards = false): Action {
  const t = text.toLowerCase().replace(/[×✕]/g, "x");

  // 1) hi/thanks/bye — yahan card bhejna hi galti hai
  if (isGreeting(t) || isAppreciation(t)) return "chat";

  // 1b) abhi abhi cards bheje the aur customer ne sirf "haan / theek hai / ok"
  //     bola — ye haami hai, naye photo ki demand nahi. Warna wahi lot dobara
  //     chala jaata tha (customer ko lagta hai bot spam kar raha hai).
  if (lastBotHadCards && isAffirmation(t) && !SHOW_VERB.test(t) && !SIZE_PATTERN.test(t) && !/\d{3,5}/.test(t))
    return "chat";

  // 2) mol-bhaav chal raha hai — naye photo thopne ka time nahi
  if (NEGOTIATION.test(t) && !SHOW_VERB.test(t)) return "chat";

  // 3) delivery/payment/MOQ/location type sawaal
  if (detectFAQ(t) && !SHOW_VERB.test(t) && !SIZE_PATTERN.test(t)) return "chat";

  // 4) saaf-saaf "dikhao / photo bhejo / aur design"
  if (SHOW_VERB.test(t) || isMoreRequest(t)) return "show";

  // 5) "haan" — sirf tab show jab bot ne khud offer kiya tha
  if (isAffirmation(t)) return botOfferedToShow(lastBotText) ? "show" : "chat";

  // 6) size/rate bola hai
  if (SIZE_PATTERN.test(t) || /\b\d{3,5}\b/.test(t) || /\b(size|rate|price|daam)\b/.test(t)) {
    // "28x32 hai kya?" = pehle jawaab do (jawaab ke saath card bhi ja sakta hai)
    return QUESTION_WORD.test(t) ? "info" : "show";
  }

  // 7) "sasta lot chahiye" type
  if (/(sasta|budget|cheap|mehnga|premium|lot chahiye|maal chahiye|jeans chahiye)/.test(t)) return "show";

  return "chat";
}

// "kaun kaun se size hain", "kya kya hai", "poora catalog" — ye poore stock ka
// sawaal hai. Pichhle message ka size/budget yahan lagana galat jawaab deta hai.
export function isCatalogQuestion(text: string): boolean {
  const t = text.toLowerCase();
  return /(kaun\s*kaun|kaun\s*se\s*size|kaun\s*konse|konse\s*konse|kaunse\s*kaunse|kya\s*kya|sab\s*size|saare\s*size|sare\s*size|size\s*list|rate\s*list|list\s*bhej|kitne\s*size|available\s*size|poora\s*catalog|pura\s*catalog|sab\s*dikha|sabhi\s*size)/.test(
    t
  );
}

// Customer ne saaf-saaf style number bola ("#17027", "style 1841") — bhale hi
// wo catalog me na ho. Aisa number mile toh generic jawaab dena galat hai.
export function taggedStyleNumber(text: string): string | null {
  const t = text.toLowerCase();
  const m =
    t.match(/#\s*(\d{3,6})/) ||
    t.match(/\b(?:style|design|article|art)\s*(?:no\.?|number)?\s*[:#]?\s*(\d{3,6})\b/);
  return m ? m[1] : null;
}

// ── JS intent parser (SOURCE OF TRUTH — filters LLM se nahi aate) ──
// prev diya toh usi conversation ka context maano — sirf jo field current
// message mein explicitly mention hui hai wahi overwrite hogi, baaki prev se
// carry forward hongi.
export function parseIntentJS(text: string, prev?: Intent | null, catalog?: Jean[]): Intent {
  const t = text.toLowerCase().replace(/[×✕]/g, "x");
  const it: Intent = prev
    ? { ...prev, style: null, saidSize: false, saidRate: false, saidGender: false }
    : {
        size: null,
        excludeSize: null,
        rateMin: null,
        rateMax: null,
        suggestedRateMin: null,
        suggestedRateMax: null,
        count: 5,
        inStock: false,
        gender: null,
        style: null,
        saidSize: false,
        saidRate: false,
        saidGender: false,
      };

  // If user confirms a previous suggestion (e.g. "ha dikha do", "haan")
  if (isAffirmation(text) && prev && !SIZE_PATTERN.test(t) && !/\d{3,5}/.test(t)) {
    if (prev.suggestedRateMin != null && prev.suggestedRateMax != null) {
      it.rateMin = prev.suggestedRateMin;
      it.rateMax = prev.suggestedRateMax;
      it.suggestedRateMin = null;
      it.suggestedRateMax = null;
    }
    return it;
  }

  if (/(male|men|mens|men's|boy|boys|gents|munde|mundeya|ladke|ladko|ladka|admi|aadmi)/.test(t)) {
    it.gender = "male";
    it.saidGender = true;
  } else if (/(female|women|womens|women's|girl|girls|ladies|ladis|ladki|ladkiyo|kudi|kudiyan|lady)/.test(t)) {
    it.gender = "female";
    it.saidGender = true;
  }

  // "kaun kaun se size hain" = poore stock ka sawaal — purana filter hatao
  if (isCatalogQuestion(t)) {
    it.size = null;
    it.excludeSize = null;
    it.rateMin = null;
    it.rateMax = null;
  }

  const isExclusion = /(alag|alawa|ilaawa|chhod|chhodkar|chhod ke|other than|except|besides)/i.test(t);
  const isChangeSize = /(doosra size|dusra size|aur size|change size|kuch aur size|alag size|koi aur size)/i.test(t);

  const sizeM = t.match(/(\d{2})\s*[x*]\s*(\d{2})/);
  if (sizeM) {
    const matchedSize = `${sizeM[1]}X${sizeM[2]}`;
    it.saidSize = true;
    if (isExclusion) {
      it.excludeSize = matchedSize;
      it.size = null;
    } else {
      it.size = matchedSize;
      it.excludeSize = null;
    }
  } else {
    // Explicit size keywords e.g. "size 30", "30 size", "waist 32", "34 no", "34 inch"
    const explicitSizeM =
      t.match(/\b(?:size|waist|no\.?|number)\s*[:#]?\s*(\d{2})\b/) ||
      t.match(/\b(\d{2})\s*(?:size|waist|no\.?|number|inch)\b/);
    if (explicitSizeM) {
      const num = parseInt(explicitSizeM[1]);
      if (num >= 24 && num <= 50) {
        it.saidSize = true;
        if (isExclusion) {
          it.excludeSize = String(num);
          it.size = null;
        } else {
          it.size = String(num);
          it.excludeSize = null;
        }
      }
    } else if (isChangeSize) {
      it.excludeSize = prev?.size || null;
      it.size = null;
    }
  }

  // "stock hai kya" = availability ka sawaal, filter nahi (sheet me stock column
  // hai hi nahi — filter lagaya toh 0 result aayega aur bot jhooth bolega)
  it.inStock = false;

  // ── style/reference number lookup ("#17027", "style 1841 ka rate") ──
  // 3-digit number rate bhi ho sakta hai, isliye catalog me match hona zaroori.
  const styleIds = new Set((catalog || []).map((r) => String(r.s)));
  const tagged =
    t.match(/#\s*(\d{3,6})/) ||
    t.match(/\b(?:style|design|article|art|number)\s*(?:no\.?|number)?\s*[:#]?\s*(\d{3,6})\b/);
  let styleHit: string | null = null;
  if (tagged && (styleIds.size === 0 || styleIds.has(tagged[1]))) {
    styleHit = tagged[1];
  } else {
    // bina tag ke: sirf 4-5 digit number jo sach me catalog me ho
    const loose = t.match(/\b(\d{4,6})\b/g) || [];
    const hit = loose.find((n) => styleIds.has(n));
    if (hit) styleHit = hit;
  }
  if (styleHit) it.style = styleHit;
  else if (prev?.style && !SIZE_PATTERN.test(t)) it.style = null; // style lookup carry na ho

  // count "5 piece dikha do" jaisa hi ho — size ke digits ko count mat samajh
  // ("30x30 dikhao" pehle 20 cards bhej deta tha)
  let clean = t;
  if (sizeM) clean = clean.replace(sizeM[0], " ");
  if (styleHit) clean = clean.split(styleHit).join(" ");
  const cM = clean.match(/\b(\d{1,2})\s*(pcs|piece|pieces|maal|jeans|design|dikha)/);
  // ek saath 8 se zyada photo bhejna WhatsApp par spam lagta hai
  if (cM) it.count = Math.max(1, Math.min(8, parseInt(cM[1])));

  let rateText = clean;
  if (cM) rateText = rateText.replace(cM[0], " ");
  const nums = (rateText.match(/\d{3,4}/g) || []).map(Number).filter((n) => n >= 100 && n <= 2000);
  const sasta = !nums.length && /(sasta|cheapest|low price|budget|kam rate)/.test(t);

  if (nums.length || sasta) {
    it.rateMin = null;
    it.rateMax = null;
    it.saidRate = true;
    if (nums.length >= 2) {
      it.rateMin = Math.min(nums[0], nums[1]);
      it.rateMax = Math.max(nums[0], nums[1]);
    } else if (/(under|niche|neeche|kam|max|tak|ke andar|sasta)/.test(t) && nums.length) {
      it.rateMax = nums[0];
    } else if (/(upar|zyada|min|above|mehnga)/.test(t) && nums.length) {
      it.rateMin = nums[0];
    } else if (nums.length) {
      it.rateMin = nums[0] - 25; // "300 range" / "450 ke aas pass" → ±25 band
      it.rateMax = nums[0] + 25;
    }
    if (sasta) it.rateMax = 9999;
  }

  return it;
}

// ── deterministic filter (SOURCE OF TRUTH — LLM nahi) ──────────
// Poori matching list deta hai (slice route.ts karega, taaki "aur dikhao" par
// naye pieces bheje ja sakein).
export function filterAll(data: Jean[], it: Intent): Jean[] {
  let rows = visible(data);
  if (it.style) return rows.filter((r) => String(r.s) === it.style);

  // Gender filter: only filter if explicitly specified
  if (it.gender === "male") {
    rows = rows.filter((r) => r.g === "Male");
  } else if (it.gender === "female") {
    rows = rows.filter(isLadies);
  }

  if (it.size) rows = rows.filter((r) => sizeMatches(r.size, it.size!));
  if (it.excludeSize) rows = rows.filter((r) => !sizeMatches(r.size, it.excludeSize!));

  if (it.rateMin != null) rows = rows.filter((r) => r.rate >= it.rateMin!);
  if (it.rateMax != null && it.rateMax < 9999) rows = rows.filter((r) => r.rate <= it.rateMax!);
  // NOTE: stock column sheet me nahi hai — is par filter mat lagao.
  if (it.inStock) rows = rows.filter((r) => r.stock == null || r.stock > 0);
  rows.sort((a, b) => a.rate - b.rate);
  return rows;
}

export function filterData(data: Jean[], it: Intent): Jean[] {
  return filterAll(data, it).slice(0, it.count);
}

// "30" → 30X32/30X34 sab match; "28X32" → exact
export function sizeMatches(rowSize: string, want: string): boolean {
  const r = rowSize.toUpperCase();
  const w = want.toUpperCase();
  if (w.includes("X")) return r === w;
  return r === w || r.startsWith(w + "X") || r.startsWith(w + " ");
}

// ── kuch na mile toh "ye nahi, par ye hai" wala sacha jawaab ───────
export interface Availability {
  matched: number;
  sizeAsked: string | null;
  sizeExists: boolean;
  sizeCount: number;
  sizeMin: number | null;
  sizeMax: number | null;
  genderLabel: string;
  availableSizes: string[];
  rateMin: number | null;
  rateMax: number | null;
  cheapest: number | null;
  relaxed: Jean[]; // kaunsa filter dhila karke maal mila
  // "stale" = pichhle message se chipki hui field hatai (customer ko batane ki
  // zaroorat nahi, wo to naye sawaal ka seedha jawaab hai)
  relaxedReason: "rate" | "size" | "gender" | "stale" | null;
  relaxedIntent: Intent | null; // jo filter sach me ye cards de raha hai
  relaxedLabel: string; // "ladies" / "gents" — text aur cards ek jaise rahein
  relaxedSizes: string[];
  relaxedMin: number | null;
  relaxedMax: number | null;
  relaxedRateToo: boolean; // budget bhi chhodna pada — customer ko batana zaroori
}

function labelOf(rows: Jean[]): string {
  const male = rows.some((r) => r.g === "Male");
  const ladies = rows.some(isLadies);
  if (male && ladies) return "gents + ladies";
  return male ? "gents" : "ladies";
}

export function checkAvailability(data: Jean[], it: Intent): Availability {
  let pool = visible(data);
  let genderLabel = "gents + ladies";
  if (it.gender === "male") {
    pool = pool.filter((r) => r.g === "Male");
    genderLabel = "gents";
  } else if (it.gender === "female") {
    pool = pool.filter(isLadies);
    genderLabel = "ladies";
  }

  const sizeRows = it.size ? pool.filter((r) => sizeMatches(r.size, it.size!)) : pool;
  const matchedRows = filterAll(data, it);
  const rates = pool.map((r) => r.rate);
  const sizeRates = sizeRows.map((r) => r.rate);

  // ── relaxation ladder ──────────────────────────────────────────
  // Sabse pehle wo filter chhodo jo customer ne ABHI nahi bola — wo pichhle
  // message se chipka hua hai. Jo usne is message me bola hai wo sabse aakhir
  // me chhodna chahiye. Warna "500 wale gents dikhao" par 3 message purana
  // 28X32 lag ke bilkul galat jawaab chala jaata tha.
  let relaxed: Jean[] = [];
  let relaxedReason: Availability["relaxedReason"] = null;
  let relaxedIntent: Intent | null = null;
  const hadBudget = it.rateMin != null || (it.rateMax != null && it.rateMax < 9999);
  // Sirf size aur rate ko "purana" maano. Gender ka apna step neeche hai jo
  // usse behtar jawaab deta hai ("gents me nahi, ladies me hai").
  const staleSize = !!it.size && !it.saidSize;
  const staleRate = hadBudget && !it.saidRate;

  if (matchedRows.length === 0) {
    const noRate = { rateMin: null, rateMax: null };
    // base = customer ne is message me jo bola, sirf wahi
    const base: Intent = {
      ...it,
      ...(staleSize ? { size: null } : {}),
      ...(staleRate ? noRate : {}),
    };
    const baseHadBudget = base.rateMin != null || (base.rateMax != null && base.rateMax < 9999);
    const basePool =
      base.gender === "male" ? visible(data).filter((r) => r.g === "Male")
      : base.gender === "female" ? visible(data).filter(isLadies)
      : visible(data);
    const baseSizeRows = base.size ? basePool.filter((r) => sizeMatches(r.size, base.size!)) : [];

    const ladder: { intent: Intent; reason: NonNullable<Availability["relaxedReason"]> }[] = [];

    // 1) purani chipki hui field hata ke dekho
    if (staleSize || staleRate) ladder.push({ intent: base, reason: "stale" });
    // 2) size to hai, sirf budget match nahi ho raha
    if (base.size && baseSizeRows.length > 0) ladder.push({ intent: { ...base, ...noRate }, reason: "rate" });
    // 3) is category me ye size nahi — doosri category dekho
    if (base.size && base.gender) {
      ladder.push({ intent: { ...base, gender: null }, reason: "gender" });
      ladder.push({ intent: { ...base, gender: null, ...noRate }, reason: "gender" });
    }
    // 4) size nahi bola, sirf rate range galat hai
    if (!base.size && baseHadBudget) ladder.push({ intent: { ...base, ...noRate }, reason: "rate" });
    // 5) ye size kahin hai hi nahi
    if (base.size) ladder.push({ intent: { ...base, size: null }, reason: "size" });
    // 6) aakhri koshish — size aur budget dono chhod do
    ladder.push({ intent: { ...base, size: null, ...noRate }, reason: base.size ? "size" : "rate" });

    for (const step of ladder) {
      const rows = filterAll(data, step.intent);
      if (rows.length > 0) {
        relaxed = rows;
        relaxedReason = step.reason;
        relaxedIntent = step.intent;
        break;
      }
    }
  }

  const relaxedRateToo = hadBudget && relaxedIntent != null && relaxedIntent.rateMin == null && relaxedIntent.rateMax == null;

  const relaxedRates = relaxed.map((r) => r.rate);

  return {
    relaxedIntent,
    relaxedRateToo,
    relaxedLabel: relaxed.length ? labelOf(relaxed) : genderLabel,
    relaxedSizes: Array.from(new Set(relaxed.map((r) => r.size))).slice(0, 5),
    relaxedMin: relaxedRates.length ? Math.min(...relaxedRates) : null,
    relaxedMax: relaxedRates.length ? Math.max(...relaxedRates) : null,
    matched: matchedRows.length,
    sizeAsked: it.size,
    sizeExists: sizeRows.length > 0,
    sizeCount: sizeRows.length,
    sizeMin: sizeRates.length ? Math.min(...sizeRates) : null,
    sizeMax: sizeRates.length ? Math.max(...sizeRates) : null,
    genderLabel,
    availableSizes: sizeStats(pool).map((s) => s.size),
    rateMin: rates.length ? Math.min(...rates) : null,
    rateMax: rates.length ? Math.max(...rates) : null,
    cheapest: rates.length ? Math.min(...rates) : null,
    relaxed,
    relaxedReason,
  };
}

// ── info-type sawaal ka seedha, sach jawaab (bina LLM ke bhi chalega) ──
// withCards=true tab bhejo jab isi reply ke saath photo bhi ja rahi ho —
// text aur cards ka matlab hamesha ek hona chahiye.
export function availabilityAnswer(data: Jean[], it: Intent, av: Availability, withCards = false): string {
  const g = av.genderLabel;
  const close = withCards ? "Ye dekhiye 👇" : "Photo dikha dun?";
  const relaxRate =
    av.relaxedMin != null && av.relaxedMax != null
      ? av.relaxedMin === av.relaxedMax
        ? `₹${av.relaxedMin}`
        : `₹${av.relaxedMin}-₹${av.relaxedMax}`
      : "";

  // specific style poocha
  if (it.style) {
    const rows = visible(data).filter((r) => String(r.s) === it.style);
    if (!rows.length)
      return `Bhaiya style #${it.style} abhi list me nahi mil raha.\nStyle number dobara check kar lijiye, ya size bata dijiye — us size ke chalte hue design dikha deta hoon.`;
    const sizes = Array.from(new Set(rows.map((r) => r.size))).join(", ");
    const rates = rows.map((r) => r.rate);
    const rateTxt =
      Math.min(...rates) === Math.max(...rates) ? `₹${rates[0]}` : `₹${Math.min(...rates)}-₹${Math.max(...rates)}`;
    return `Haanji bhaiya, style #${it.style} available hai.\nSize: ${sizes} | Rate: ${rateTxt} (wholesale, per piece).\nKitne pcs ka lot banau?`;
  }

  // pichhle message ka filter hata ke jawaab mila — customer ko purani baat
  // yaad dilane ki zaroorat nahi, seedha uske naye sawaal ka jawaab do
  if (av.matched === 0 && av.relaxedReason === "stale") {
    const lbl = av.relaxedLabel;
    return `Haanji bhaiya, ${lbl} me ${av.relaxed.length} design hain ${relaxRate} me.\nSizes: ${av.relaxedSizes.join(
      ", "
    )}.\n${close}`;
  }

  // rate hi range se bahar hai (size nahi bola tha, ya purana size hata diya)
  if (av.matched === 0 && av.relaxedReason === "rate" && (!it.size || !it.saidSize)) {
    const tooHigh = it.rateMin != null && av.relaxedMax != null && it.rateMin > av.relaxedMax;
    const head = tooHigh
      ? `Bhaiya itna mehnga maal hum rakhte hi nahi 😄 ${av.relaxedLabel} me top rate ₹${av.relaxedMax} tak jaata hai.`
      : `Bhaiya us rate me ${av.relaxedLabel} ka maal nahi banta, yahan ${relaxRate} chalta hai.`;
    return `${head}\nSizes: ${av.relaxedSizes.join(", ")}.\n${close}`;
  }

  // ye size is category me nahi, par doosri category me hai
  if (av.matched === 0 && av.relaxedReason === "gender") {
    // budget bhi hatana pada toh chhupao mat — warna customer ko lagta hai bot
    // ne uski baat suni hi nahi
    const budgetNote = av.relaxedRateToo
      ? `Aapke budget me bhi is size me nahi hai, iska rate ${relaxRate} chalta hai.`
      : `${av.relaxedLabel} me ${av.relaxed.length} pcs hain, rate ${relaxRate}.`;
    return `Bhaiya ${it.size} ${g} me nahi chal raha 😅\n${budgetNote}\n${close}`;
  }

  // size hai, par budget me nahi — budget UPAR hai ya NEECHE, dono ka matlab
  // ulta hai. Pehle dono me "aapke budget me nahi banta" ja raha tha, jo
  // ₹1000 maangne wale customer ko ulta lagta tha.
  if (av.matched === 0 && av.relaxedReason === "rate" && it.size) {
    const askedAbove = it.rateMin != null && av.sizeMax != null && it.rateMin > av.sizeMax;
    const note = askedAbove
      ? `Itna mehnga is size me hai hi nahi bhaiya — sabse upar wala ₹${av.sizeMax} ka hai.`
      : `Aapke budget me is size me maal nahi banta, sabse sasta ₹${av.sizeMin} ka hai.`;
    return `Bhaiya ${it.size} ${g} me ${av.sizeCount} pcs hain, unka rate ₹${av.sizeMin}-₹${av.sizeMax} chalta hai.\n${note}\n${close}`;
  }

  // ye size kahin nahi hai
  if (av.matched === 0 && av.relaxedReason === "size") {
    const lead = it.rateMin != null || (it.rateMax != null && it.rateMax < 9999) ? "Isi budget me" : "Abhi";
    return `Bhaiya ${it.size} abhi hai hi nahi 😅\n${lead} ${av.relaxedSizes.join(", ")} chal raha hai (${relaxRate}).\n${close}`;
  }

  // size poocha aur wo size hai hi nahi (koi alternative bhi nahi)
  if (it.size && !av.sizeExists) {
    return `Bhaiya ${it.size} abhi ${g} me nahi chal raha 😅\nAbhi ye sizes ready hain: ${av.availableSizes.join(", ")}.\nInme se koi bata dijiye, turant photo bhej deta hoon.`;
  }

  if (av.matched === 0) {
    return `Bhaiya is combination me abhi maal nahi hai 😅\n${g} me sizes ${av.availableSizes.join(", ")} aur rate ₹${av.rateMin}-₹${av.rateMax} chal raha hai.\nBudget ya size thoda adjust kar lijiye, best lot bana dunga.`;
  }

  // maal hai — saaf figure ke saath jawaab
  if (it.size) {
    return `Haanji bhaiya, ${it.size} ${g} me ${av.matched} design ready hain.\nRate ₹${av.sizeMin}-₹${av.sizeMax} per piece (wholesale).\n${close}`;
  }
  return `Haanji bhaiya, ${g} me ${av.matched} design chal rahe hain, rate ₹${av.rateMin}-₹${av.rateMax}.\nSizes: ${av.availableSizes.join(", ")}.\n${
    withCards ? "Ye dekhiye 👇" : "Aapko kaunsa size chahiye?"
  }`;
}

// ── Delhi/UP Wholesale Persona wrapper (sirf text, data nahi) ─────────────
export function personaLine(it: Intent, n: number, catalog?: Jean[]): string {
  if (it.style)
    return n === 0
      ? `Bhaiya 😅 style #${it.style} ka maal abhi list me nahi hai.\nDusra style number ya size bata dijiye, turant dikha deta hoon.`
      : `Haanji bhaiya! Style #${it.style} ka photo aur rate ye raha 👇`;

  if (n === 0) {
    const av = catalog ? checkAvailability(catalog, it) : null;
    if (av) return availabilityAnswer(catalog!, it, av);
    return "Bhaiya 😅 is size aur rate range me abhi maal nahi hai.\nThoda budget badha lijiye ya doosra size bata dijiye.";
  }

  const sizeTxt = it.excludeSize ? `${it.excludeSize} ke alawa` : it.size ? it.size : "sabhi sizes";
  const rateTxt =
    it.rateMin != null && it.rateMax != null && it.rateMax < 9999
      ? `₹${it.rateMin}-₹${it.rateMax}`
      : it.rateMax != null && it.rateMax < 9999
      ? `₹${it.rateMax} tak`
      : it.rateMin != null
      ? `₹${it.rateMin}+`
      : "har rate";

  const SHOWCASE_TEMPLATES = [
    `Haanji bhaiya! ${sizeTxt} me ${rateTxt} wale ${n} design ready hain 👇`,
    `Ye dekhiye bhaiya — ${sizeTxt} me ${rateTxt} ke ${n} top running article 👇`,
    `Bhaiya ${sizeTxt} me ${rateTxt} range ka direct factory wash lot, ${n} piece design 👇`,
  ];
  return SHOWCASE_TEMPLATES[Math.floor(Math.random() * SHOWCASE_TEMPLATES.length)];
}

// ── cards ke saath jaane wali line — total, rate band aur agla kadam ──
// Sirf "5 design ready hain" bolne se LLM khud filler line jodne lagta hai,
// isliye draft me hi kaam ki jaankari bhar do.
export function showLine(
  data: Jean[],
  it: Intent,
  cards: Jean[],
  total: number,
  av: Availability,
  isMore = false
): string {
  // style ka draft numbers ke saath hi jaana chahiye — warna LLM apne mann se
  // rate/size bhar deta hai (card kuch aur, text kuch aur)
  if (it.style) return availabilityAnswer(data, it, av, true);

  // customer ne jo maanga (size + budget) wo reply me dohrao — warna lagta hai
  // bot ne uski baat suni hi nahi
  const asked = [
    it.size,
    it.gender === "male" ? "gents" : it.gender === "female" ? "ladies" : null,
    it.rateMin != null && it.rateMax != null && it.rateMax < 9999
      ? `₹${it.rateMin}-₹${it.rateMax}`
      : it.rateMax != null && it.rateMax < 9999
      ? `₹${it.rateMax} tak`
      : it.rateMin != null
      ? `₹${it.rateMin}+`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const what = asked || av.genderLabel;

  const rates = cards.map((r) => r.rate);
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const band = lo === hi ? `₹${lo}` : `₹${lo}-₹${hi}`;

  return [
    isMore
      ? `Ye lijiye bhaiya, ${what} ke agle ${cards.length} design 👇`
      : total > cards.length
      ? `Haanji bhaiya! ${what} me total ${total} design hain.`
      : `Haanji bhaiya! ${what} me ${total} design hain.`,
    isMore ? `Ye ${band} wale hain, per piece wholesale.` : `Ye ${band} wale ${cards.length} sabse pehle dekh lijiye 👇`,
    total > cards.length ? `Aur dikhau ya inhi me se lot bana dun?` : `Kitne pcs ka lot banau?`,
  ].join("\n");
}

// ── "ye kitne ka padega" — abhi jo cards dikhe unke bare me sawaal ──────
export function isLastLotQuestion(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!/(kitne|kitna|kya|rate|price|daam|total|final)/.test(t)) return false;
  return /((ye|yeh|iska|inka|isme|inme|is\s*lot|in\s*sab|ye\s*sab|upar\s*wale)\s*.{0,12}(kitne|kitna|rate|price|daam|padega|hoga|lagega|ka))|kitne\s*ka\s*padega|kitna\s*padega|final\s*kya|total\s*kitna/.test(
    t
  );
}

// ── order quantity ("15 pcs chahiye", "2 lot bana do") ─────────────
// Bot khud poochta hai "kitne pcs ka lot banau?" — jawaab samajhna zaroori hai,
// warna wo MOQ ka rata-ratayaa bhashan de deta hai.
export function parseOrderQty(text: string): { n: number; unit: "pcs" | "lot" } | null {
  const t = text.toLowerCase();
  if (SHOW_VERB.test(t)) return null; // "5 piece dikhao" = kitne dikhane hain, order nahi
  const m = t.match(/\b(\d{1,4})\s*(lot|lots|pcs|pc|piece|pieces|peice|jeans|maal)\b/);
  if (!m) return null;
  const n = parseInt(m[1]);
  if (!n || n > 5000) return null;
  return { n, unit: /lot/.test(m[2]) ? "lot" : "pcs" };
}

export function orderAnswer(q: { n: number; unit: "pcs" | "lot" }, cards: Jean[]): string {
  const rateTxt = cards.length
    ? (() => {
        const rates = cards.map((r) => r.rate);
        const lo = Math.min(...rates);
        const hi = Math.max(...rates);
        return lo === hi ? `₹${lo}` : `₹${lo}-₹${hi}`;
      })()
    : null;

  if (q.unit === "lot") {
    const pcs = q.n * 18;
    return [
      `Badhiya bhaiya! ${q.n} lot matlab lagbhag ${pcs} pcs ban jaayenge.`,
      rateTxt ? `Rate ${rateTxt} per piece chal raha hai, mix size/colour daal dunga.` : `Size mix chahiye ya ek hi size?`,
      `Advance UPI aate hi aaj hi dispatch kara deta hoon. City bata dijiye.`,
    ].join("\n");
  }

  if (q.n < 15) {
    return [
      `Bhaiya ${q.n} pcs thoda kam pad jaata hai 😅`,
      `1 lot minimum 15-20 pcs ka hota hai, mix size/colour.`,
      `15 pcs kar lijiye, abhi dispatch kara deta hoon.`,
    ].join("\n");
  }

  if (q.n >= 100) {
    return [
      `Wah bhaiya! ${q.n} pcs matlab bulk order ban gaya.`,
      rateTxt ? `Rate ${rateTxt} per piece, aur is quantity par scheme wala extra discount bhi lag jaayega.` : `Is quantity par scheme wala extra discount bhi lag jaayega.`,
      `Size mix bata dijiye, aaj hi packing shuru kara deta hoon.`,
    ].join("\n");
  }

  return [
    `Theek hai bhaiya, ${q.n} pcs ka lot bana deta hoon 👍`,
    rateTxt ? `Rate ${rateTxt} per piece rahega.` : `Size mix chahiye ya ek hi size?`,
    `Aapki city aur size mix bata dijiye, dispatch kara deta hoon.`,
  ].join("\n");
}

// filter badla par result wahi nikla — photo dobara mat bhejo, sach bol do
export function sameLotLine(cards: Jean[], total: number, wantedCheaper = false): string {
  const rates = cards.map((r) => r.rate);
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const band = lo === hi ? `₹${lo}` : `₹${lo}-₹${hi}`;
  const head = wantedCheaper
    ? `Bhaiya isse sasta is size me kuch nahi hai — ${band} wala hi sabse neeche hai 👆`
    : `Bhaiya yahi ${band} wala lot sabse upar hai, jo abhi dikhaya tha 👆`;
  return [
    head,
    total > cards.length ? `Aur design dekhne hain toh "aur dikhao" bol dijiye.` : `Is filter me bas itna hi maal hai.`,
    `Kitne pcs ka lot banau?`,
  ].join("\n");
}

// "theek hai / haan" cards dekhne ke baad — dobara photo nahi, order ki baat
export function ackAfterCards(cards: Jean[]): string {
  const rates = cards.map((r) => r.rate);
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const band = lo === hi ? `₹${lo}` : `₹${lo}-₹${hi}`;
  return [
    `Theek hai bhaiya 👍`,
    `Ye ${band} wale hain, 1 lot = 15-20 pcs.`,
    `Kitne pcs ka lot banau, ya koi aur size dekhna hai?`,
  ].join("\n");
}

// jo cards abhi bheje the unhi ka seedha hisaab
export function lastLotAnswer(cards: Jean[]): string {
  const rates = cards.map((r) => r.rate);
  const lo = Math.min(...rates);
  const hi = Math.max(...rates);
  const band = lo === hi ? `₹${lo}` : `₹${lo}-₹${hi}`;
  const sizes = Array.from(new Set(cards.map((r) => r.size))).join(", ");
  return [
    `Bhaiya jo design abhi dikhaye wo ${band} per piece hain (wholesale rate).`,
    `Size ${sizes} | 1 lot = 15-20 pcs, mix chal jaata hai.`,
    `Kitne pcs ka lot bana dun?`,
  ].join("\n");
}

// ── chit-chat ka fallback (Groq down ho tab bhi bot insaan lage) ──────
// Har message ka draft ALAG hona chahiye — warna bot har baat par wahi
// rate-list wala ratta-ratayaa jawaab de deta hai aur robot lagta hai.
const ABUSE =
  /(chutiy|chutia|bakwas|bakwaas|faltu|fltu|bekar|bekaar|bewakoof|gandu|madarch|bhosdi|behen\s*ke|jhoot\s*bol|time\s*waste|pagal|nikamma|ullu|besharam|band\s*kar)/i;
const BOT_QUESTION = /(bot\b|robot|\bai\b|machine|computer|automatic|insaan\s*ho|aadmi\s*ho|banda\s*ho|real\s*ho)/i;
const IDENTITY_QUESTION =
  /(naam\s*kya|tumhara\s*naam|aapka\s*naam|tum\s*kaun|aap\s*kaun|who\s*are\s*you|kya\s*kaam|kaam\s*kya|kaha\s*se\s*ho)/i;
const OFF_TOPIC =
  /(khana|khaya|khane|mausam|weather|cricket|match|film|movie|gaana|politics|modi|rahul|chunav|election|shaadi|padhai|news|joke|chutkula|love|girlfriend)/i;

export function smallTalkLine(text: string, summary: ReturnType<typeof getCatalogSummary>): string {
  if (isGreeting(text))
    return `Namaste bhaiya! 🙏 John DV Jeans Wholesale, Gandhi Nagar Delhi.\nGents ${summary.maleCount} aur ladies ${summary.bCount} design abhi ready hain.\nAapko kaunsa size chahiye?`;

  if (isAppreciation(text))
    return `Shukriya bhaiya! 😊\nOrder final karna ho ya koi aur size dekhna ho toh bas bata dijiye.`;

  // naraz customer — safai mat do, dikkat poocho
  if (ABUSE.test(text))
    return `Arre bhaiya naraz mat hoiye 🙏\nBataiye kya dikkat aayi, main abhi theek karta hoon.\nSeedha size aur budget bol dijiye, wahi maal dikhata hoon.`;

  if (BOT_QUESTION.test(text))
    return `Bhaiya main John DV — Gandhi Nagar Delhi se jeans ka wholesale karta hoon.\nYahan aapko live stock aur rate turant mil jaata hai.\nBataiye kaunsa size dekhna hai?`;

  if (IDENTITY_QUESTION.test(text))
    return `John DV bolta hoon bhaiya, Tank Road / Gandhi Nagar Delhi se.\nGents aur ladies dono ka wholesale lot rehta hai.\nAapko kya chahiye?`;

  // rajneeti/khana/cricket — sundar tarike se kaam par wapas
  if (OFF_TOPIC.test(text))
    return `Haha bhaiya wo apna line nahi hai 😄\nHum toh din bhar jeans ke lot me lage rehte hain.\nAapko kaunsa size aur budget dekhna hai?`;

  if (NEGOTIATION.test(text))
    return `Bhaiya rate already factory-direct hai, isse neeche nahi jaata 😅\nHaan, quantity badhaoge toh scheme me thoda adjust ho jaata hai.\nKitne pcs ka plan hai?`;

  return `Haanji bhaiya, boliye 😊\nSize aur budget bata dijiye, turant maal dikha deta hoon.`;
}
