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

// ── Catalog Data Summary for LLM Context ───────────────────────────
export function getCatalogSummary(data: Jean[]) {
  const maleItems = data.filter((r) => r.g === "Male");
  const bItems = data.filter((r) => r.g === "B");
  const maleRates = maleItems.map((r) => Number(r.rate)).filter(Boolean);
  const bRates = bItems.map((r) => Number(r.rate)).filter(Boolean);
  const maleSizes = Array.from(new Set(maleItems.map((r) => r.size)));
  const bSizes = Array.from(new Set(bItems.map((r) => r.size)));

  return {
    totalItems: data.length,
    maleCount: maleItems.length,
    maleMinRate: maleRates.length > 0 ? Math.min(...maleRates) : 380,
    maleMaxRate: maleRates.length > 0 ? Math.max(...maleRates) : 500,
    maleSizes: maleSizes.slice(0, 15).join(", "),
    bCount: bItems.length,
    bMinRate: bRates.length > 0 ? Math.min(...bRates) : 210,
    bMaxRate: bRates.length > 0 ? Math.max(...bRates) : 410,
    bSizes: bSizes.slice(0, 15).join(", "),
  };
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
  ];
  return PATTERNS.some((re) => re.test(core));
}

// ── product-intent gate (isse kam kuch bhi ho toh chit-chat samjho) ──
// Whitelist ke bharose na raho — sirf tabhi product list dikhao jab
// message me actually size/rate/stock/lot wala signal ho.
export function hasProductIntent(text: string): boolean {
  const t = text.toLowerCase().replace(/[×✕]/g, "x");
  if (/\d{2}\s*[x*]\s*\d{2}/.test(t)) return true; // "28x32" size pattern
  if (/\d{3,4}/.test(t)) return true; // koi bhi 3-4 digit number = likely rate
  if (
    /(stock|available|ready|maal|jeans|pant|denim|dikha|chahiye|price|rate|daam|size|sasta|mehnga|range|pcs|piece|lot|wholesal|catalog|sample|gandhi nagar|tank road)/.test(
      t
    )
  )
    return true;
  return false;
}

// ── FAQ detector (wholesale objections / business queries) ─────────────
export function detectFAQ(text: string): { key: string; reply: string } | null {
  const t = text.toLowerCase();

  if (/(kahan|where|address|location|shop|dukaan|showroom|gandhi nagar|tank road|aana|visit|office)/.test(t)) {
    return {
      key: "location",
      reply:
        "Hamari main wholesale showroom Delhi (Tank Road / Gandhi Nagar) me hai bhaiya! Shop subah 10 se shaam 8 baje tak open rehti hai. Aap direct visit kar sakte hain ya online order bhi de sakte hain. Aapko kaunsa size aur rate range dikhaun bhaiya?",
    };
  }

  if (/(moq|minimum|piece|pcs|single|retail|kitne piece|lot size|kitna order|kitna lena|1 pc|ek pc)/.test(t)) {
    return {
      key: "moq",
      reply:
        "Hum purely wholesale me deal karte hain bhaiya! Single piece retail nahi milta, minimum order 1 lot (15-20 pcs mix size/color) ka hota hai. Aapko kaunsa size aur rate range ka lot dikhaun?",
    };
  }

  if (/(cod|cash on delivery|payment|pay|online|gpay|phonepe|token|advance)/.test(t)) {
    return {
      key: "cod",
      reply:
        "Haanji bhaiya! Advance payment (UPI/GPay/PhonePe/Bank Transfer) par instant dispatch hoti hai, aur partial COD option bhi available hai (chota token advance + baki delivery par). Aapko kaunsa size aur price range dikhaun?",
    };
  }

  if (/(delivery|deliver|shipping|transport|courier|kab tak|kitne din|pan india|bhej|pohanchega)/.test(t)) {
    return {
      key: "shipping",
      reply:
        "Haanji bhaiya! Pure India me Transport aur Courier se fast delivery hoti hai (Delhi se 2-4 din me aapke city me delivery). Packing fully safe rehti hai. Aap kis city se hain aur kaun sa size chahiye bhaiya?",
    };
  }

  if (/(quality|fabric|cloth|washing|stretch|color|stitching|guarantee|fit|material|denim)/.test(t)) {
    return {
      key: "quality",
      reply:
        "Bhaiya hum top-grade power-stretch denim aur heavy washings me deal karte hain. Color, stitching aur fitting ki 100% replacement guarantee milti hai! Aapko budget sasta lot chahiye ya premium heavy stretch?",
    };
  }

  if (/(catalog|pdf|photo|photos|image|picture|sample|pic|pics)/.test(t)) {
    return {
      key: "catalog",
      reply:
        "Haanji bhaiya! Live inventory cards hum yahan chat par turant dikha rahe hain, aur full bulk PDF catalog aapko WhatsApp par bhi mil jayega. Aap size aur price range bataiye, fresh stock abhi dikhata hoon!",
    };
  }

  if (/(discount|margin|bargain|kam karo|kam hoga|bulk order|wholesal rate|sasta karo)/.test(t)) {
    return {
      key: "discount",
      reply:
        "Bhaiya hum direct factory wholesale rate dete hain, jisse aapko retail counter par 40% se 60% ka badiya margin milega! 100+ pcs ke bulk order par extra scheme discount bhi milta hai. Konsa size aur rate dekhein bhaiya?",
    };
  }

  if (/(number|contact|phone|call|talk|baat|mobile)/.test(t)) {
    return {
      key: "contact",
      reply:
        "Aap yahan chat par turant size aur rate bataiye bhaiya, instant stock dikhata hoon! Bulk order requirement ke liye hum aapko direct wholesale desk number provide kar denge.",
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

// ── JS intent parser (Groq na ho toh yahi chalega) ───────────
// prev diya toh usi conversation ka context maano — sirf jo field current
// message mein explicitly mention hui hai wahi overwrite hogi, baaki prev se
// carry forward hongi.
export function parseIntentJS(text: string, prev?: Intent | null): Intent {
  const t = text.toLowerCase().replace(/[×✕]/g, "x");
  const it: Intent = prev
    ? { ...prev, style: null } // style ek-baar wala lookup hai
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
      };

  // If user confirms a previous suggestion (e.g. "ha dikha do", "haan")
  if (isAffirmation(text) && prev) {
    if (prev.suggestedRateMin != null && prev.suggestedRateMax != null) {
      it.rateMin = prev.suggestedRateMin;
      it.rateMax = prev.suggestedRateMax;
      it.suggestedRateMin = null;
      it.suggestedRateMax = null;
    } else if (prev.gender === "male" && (prev.rateMax == null || prev.rateMax < 380)) {
      it.rateMin = 380;
      it.rateMax = 430;
      it.suggestedRateMin = null;
      it.suggestedRateMax = null;
    }
    return it;
  }

  if (/(male|men|mens|men's|boy|boys|gents|munde|mundeya|ladke|ladko|ladka)/.test(t)) it.gender = "male";
  else if (/(female|women|womens|women's|girl|girls|ladies|ladki|ladkiyo|kudi|kudiyan)/.test(t)) it.gender = "female";

  const isExclusion = /(alag|alawa|ilaawa|chhod|chhodkar|chhod ke|other than|except|besides)/i.test(t);
  const isChangeSize = /(doosra size|dusra size|aur size|change size|kuch aur size|alag size|koi aur size)/i.test(t);

  const sizeM = t.match(/(\d{2})\s*[x*]\s*(\d{2})/);
  if (sizeM) {
    const matchedSize = `${sizeM[1]}X${sizeM[2]}`;
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

  if (/(stock|available|ready|hai kya|maal ready)/.test(t)) it.inStock = true;

  // ── style/reference number lookup (jaise "1841 size dikha do", "#1841", "style 1840") ──
  const styleM =
    t.match(/#\s*(\d{3,5})/) ||
    t.match(/\bstyle\s*(?:no\.?|number)?\s*[:#]?\s*(\d{3,5})\b/) ||
    t.match(/\b(\d{3,5})\s*(?:ka\s*|da\s*)?(?:size|style|stock|rate|price)\b/) ||
    t.match(/\b(?:size|style|stock|rate|price)\s*(?:of|ka|da)?\s*[:#]?\s*(\d{3,5})\b/);
  if (styleM) it.style = styleM[1];

  const cM = t.match(/(\d{1,2})\s*(pcs|piece|pieces|maal|jeans|dikha)/);
  if (cM) it.count = Math.min(20, parseInt(cM[1]));

  let rateText = t;
  if (sizeM) rateText = rateText.replace(sizeM[0], " ");
  if (styleM) rateText = rateText.replace(styleM[0], " ");
  if (cM) rateText = rateText.replace(cM[0], " ");
  const nums = (rateText.match(/\d{3,4}/g) || []).map(Number).filter((n) => n >= 100 && n <= 2000);
  const sasta = !nums.length && /(sasta|cheapest|low price|budget)/.test(t);

  if (nums.length || sasta) {
    it.rateMin = null;
    it.rateMax = null;
    if (nums.length >= 2) {
      it.rateMin = Math.min(nums[0], nums[1]);
      it.rateMax = Math.max(nums[0], nums[1]);
    } else if (/(under|niche|neeche|kam|max|tak|ke andar|sasta)/.test(t) && nums.length) {
      it.rateMax = nums[0];
    } else if (/(upar|zyada|min|above|mehnga)/.test(t) && nums.length) {
      it.rateMin = nums[0];
    } else if (nums.length) {
      it.rateMin = nums[0] - 25;   // "300 range" / "450 ke aas pass" → ±25 band
      it.rateMax = nums[0] + 25;
    }
    if (sasta) it.rateMax = 9999;
  }

  return it;
}

// ── deterministic filter (SOURCE OF TRUTH — LLM nahi) ──────────
export function filterData(data: Jean[], it: Intent): Jean[] {
  let rows = data.filter((r) => r.g !== "A"); // Group A hamesha skip
  if (it.style) return rows.filter((r) => String(r.s) === it.style).slice(0, it.count);

  // Gender filter: only filter if explicitly specified
  if (it.gender === "male") {
    rows = rows.filter((r) => r.g === "Male");
  } else if (it.gender === "female") {
    rows = rows.filter((r) => r.g !== "Male");
  }

  if (it.size) {
    const sUpper = it.size.toUpperCase();
    if (sUpper.includes("X")) {
      rows = rows.filter((r) => r.size.toUpperCase() === sUpper);
    } else {
      // Single waist size matching (e.g. "30" matches "30X32", "30X34", "30")
      rows = rows.filter((r) => {
        const rUpper = r.size.toUpperCase();
        return rUpper === sUpper || rUpper.startsWith(sUpper + "X") || rUpper.startsWith(sUpper + " ");
      });
    }
  }

  if (it.excludeSize) {
    const exUpper = it.excludeSize.toUpperCase();
    rows = rows.filter((r) => {
      const rUpper = r.size.toUpperCase();
      return rUpper !== exUpper && !rUpper.startsWith(exUpper + "X") && !rUpper.startsWith(exUpper + " ");
    });
  }

  if (it.rateMin != null) rows = rows.filter((r) => r.rate >= it.rateMin!);
  if (it.rateMax != null && it.rateMax < 9999) rows = rows.filter((r) => r.rate <= it.rateMax!);
  if (it.inStock) rows = rows.filter((r) => r.stock != null && r.stock > 0);
  rows.sort((a, b) => a.rate - b.rate);
  return rows.slice(0, it.count);
}

// ── Delhi/UP Wholesale Persona wrapper (sirf text, data nahi) ─────────────
export function personaLine(it: Intent, n: number, catalog?: Jean[]): string {
  if (it.style)
    return n === 0
      ? `Bhaiya 😅 style #${it.style} ka maal abhi stock out hai.`
      : `Haanji bhaiya! Style #${it.style} ka photo aur rate ye raha 👇`;

  if (n === 0) {
    if (it.gender === "male" && it.rateMax != null && catalog && catalog.length > 0) {
      const maleRates = catalog.filter((r) => r.g === "Male").map((r) => Number(r.rate)).filter(Boolean);
      if (maleRates.length > 0) {
        const minMaleRate = Math.min(...maleRates);
        if (it.rateMax < minMaleRate) {
          it.suggestedRateMin = minMaleRate;
          it.suggestedRateMax = minMaleRate + 50;
          const PITCHES = [
            `Bhaiya 😅 Male jeans me badiya quality starting ₹${minMaleRate} se shuru hoti hai. Aapko ₹${minMaleRate}–₹${minMaleRate + 50} range ke top designs dikhaun?`,
            `Arre bhaiya ₹${it.rateMax} me toh wholesale me kapda bhi nahi aata 😅 Male jeans ₹${minMaleRate} se start hain. ₹${minMaleRate}–₹${minMaleRate + 50} wale super hit lot dikhaun?`,
            `Bhaiya 😅 Male category me minimum rate ₹${minMaleRate} hai. Boliyega toh ₹${minMaleRate}–₹${minMaleRate + 50} range ke top articles abhi dikhata hoon?`,
          ];
          return PITCHES[Math.floor(Math.random() * PITCHES.length)];
        }
      }
    }
    return "Bhaiya 😅 is size aur rate range me abhi stock available nahi hai. Thoda budget badhaiye ya doosra size try kijiye.";
  }

  const sizeTxt = it.excludeSize ? `${it.excludeSize} ke alawa` : it.size ? it.size : "sabhi sizes";
  const rateTxt =
    it.rateMin != null && it.rateMax != null && it.rateMax < 9999
      ? `₹${it.rateMin}–₹${it.rateMax}`
      : it.rateMax != null && it.rateMax < 9999
      ? `₹${it.rateMax} tak`
      : it.rateMin != null
      ? `₹${it.rateMin}+`
      : "har rate";

  const SHOWCASE_TEMPLATES = [
    `Haanji bhaiya! 🔥 ${sizeTxt} me ${rateTxt} range ke ${n} best design ready hain, dekhiye 👇`,
    `Bhaiya ye dekhiye ${sizeTxt} me ${rateTxt} wale top running articles 👇`,
    `Ye dekhiye bhaiya! ${sizeTxt} me ${rateTxt} rate ke direct factory wash lot 👇`,
    `Haanji bhaiya! ${sizeTxt} me ${rateTxt} range ke super hit designs hazir hain 👇`,
  ];
  return SHOWCASE_TEMPLATES[Math.floor(Math.random() * SHOWCASE_TEMPLATES.length)];
}
