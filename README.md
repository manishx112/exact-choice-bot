# John DV — Delhi Jeans Wholesale Chat Support (Next.js)

Delhi/UP wholesale expert persona jeans chat bot. Size + rate samajh ke live sheet data se
product cards dikhata hai. Data ka source-of-truth deterministic filter hai —
LLM sirf reply ko human banata hai, rate/size/count kabhi khud nahi banata.

> ⚠️ Naye sheet me **Stock column aa gaya hai** (kai rows me blank bhi hai), par
> filter abhi **band** hai — `parseIntentJS` `inStock` hamesha `false` rakhta hai.
> Blank stock ko "khatam" maan liya toh filter poora catalog kha jaata hai aur bot
> har baar "kuch nahi mila" bolta hai. Stock 0 wale design hatane hain toh yahi
> chalu karna hai (`filterAll` blank ko pehle se "pata nahi" maanta hai).

## Setup
```bash
npm install
cp .env.example .env.local   # values bhar do
npm run dev                  # http://localhost:3000
```

## Env
- `APPS_SCRIPT_URL` — Apps Script web-app URL (data source). Comma se backup URL
  bhi de sakte ho: pehla 404 / timeout de toh doosra. Fail hua URL 10 min skip
  hota hai (404 wala deployment bhi ~30 sec laga ke mana karta hai). Script ~10-30
  sec leta hai, isliye fetch ka timeout 60 sec hai. Asli URL `.env.example` me
  commit mat karna — usse poora catalog, Group A samet, koi bhi khol sakta hai.
- `GEMINI_API_KEY` — optional (aistudio.google.com → API Keys, free tier).
- `GEMINI_MODELS` — comma se alag ki hui list, **order hi priority hai**.
  Default `gemini-3.5-flash-lite,gemini-3.1-flash-lite`.
  Pehla model fail (404 band / 429 quota / 503 busy / 3 sec me jawaab nahi) toh
  doosra. Free tier me har model ka quota alag hai (15 request/min), isliye list
  chalti hai. **`-latest` wale naam mat daalo** — `gemini-flash-lite-latest` asal
  me `gemini-3.5-flash-lite` hi hai, usi ka quota khata hai. **"flash-lite" hi
  rakho** — bade aur thinking model 8-12 sec lete hain aur reply beech me kat
  jaati hai. 1.5 / 2.0 / 2.5 wale sab band ho chuke hain (404 "no longer available").
- `GROQ_API_KEY` — optional, **aakhri sahara**. Gemini ka koi model na chale
  tabhi chalta hai, aur ~1 sec me jawaab de deta hai.
- `GROQ_MODEL` — default `openai/gpt-oss-120b`. Model decommission ho jaaye toh
  yahi badalna hai (`curl -H "Authorization: Bearer $KEY" https://api.groq.com/openai/v1/models`
  se live list mil jaati hai). gpt-oss apni "reasoning" bhi token budget me
  likhta hai, isliye `route.ts` un par `reasoning_effort: "low"` bhejta hai —
  warna reply beech me kat jaati hai.
- Poora ladder: Gemini model 1 → model 2 → Groq (Groq ke liye 3 sec hamesha bache rehte hain; 429 mile toh 1-3 sec
  ruk ke ek aakhri try) → sab fail toh seedha draft. Sab milke 8 sec se zyada
  nahi. Fail hua model thodi der ke liye "bench" ho jaata hai (404 → restart
  tak, 429 → 60 sec, 503 → 30 sec), taaki har message par wahi galti dobara na
  ho. Har failure log me `[gemini:<model>] http 429: ...` / `[groq] ...` dikhta hai.
- `NEXT_PUBLIC_IMG_MODE` — sirf bache hue **Drive** photos ke liye: `public`
  (Drive public link) ya `proxy` (private-safe)

## Images — ImageKit
Sheet ka `Image Kit Link` column ab seedha ImageKit URL deta hai
(`https://ik.imagekit.io/.../17027_32X36_MALE_R500.jpeg`). Browser use seedha
load karta hai — proxy nahi chahiye. Card par `?tr=w-400` lagta hai, jisse ImageKit
chhota version bhejta hai (410KB → 42KB); wo fail ho toh original URL.
Jo rows abhi Drive link hain (aur purana script, jiska column `Image Upload` tha)
wo neeche wale Drive raaste se hi chalti hain — `normalize()` dono samajhta hai.

## ⚠️ Images — 403 fix (public hone pe bhi)

Agar file public hai phir bhi 403 aata hai, toh 2 me se ek wajah hai:
1. **Workspace/org account** — "Anyone with link" = sirf org ke andar. Anonymous = 403.
2. **Browser throttle/referrer** — Google lh3/uc pe hotlink block karta hai.

Dono ka solution: **server-side proxy** (default mode). `.env.local` me:
```
NEXT_PUBLIC_IMG_MODE=proxy
```
Frontend `/api/img?id=...` hit karega, jo Drive se bytes SERVER-side laata hai
(browser 403 yahan lagta hi nahi). Ye already `app/api/img/route.ts` me ready hai.

### Pin down the real cause (30 sec test)
Terminal me apni kisi file ka ID daal ke:
```bash
curl -sI "https://drive.google.com/thumbnail?id=FILE_ID&sz=w600" | head -5
```
- `content-type: image/...` aaya = public, proxy 100% chalega.
- `403` / login redirect aaya = file truly public NAHI (Workspace org-share).
  Fix: file/folder → Share → **"Anyone on the internet with the link"** (not org).
  Ya files ko personal Gmail Drive me le jao.

## Architecture

**Sabse zaroori baat: LLM koi faisla nahi leta.** Wo sirf pehle se bana hua
sacha jawaab natural Hinglish me dobara likhta hai. Isi wajah se bot na jhooth
bolta hai, na har baat par photo thopta hai.

```
page.tsx (chat UI)
  → POST /api/chat   { message, prevIntent, history, shownKeys, lastCards }
      → getCatalog()        ← 5 min cache + stale-while-revalidate + in-flight dedup
      → answerWithSQL()     ← sirf ginti wale sawaal (neeche dekho)
      → routeAction()       ← JS decide karta hai: chat / info / show
      → parseIntentJS()     ← size, rate, gender, style — sab regex se (SOURCE OF TRUTH)
      → filterAll()         ← deterministic filter
      → draft banao         ← showLine / availabilityAnswer / detectFAQ / smallTalkLine
      → polish()            ← Groq sirf draft ko human banata hai
          └ numeric guard: draft me na ho aisa koi number aaya → draft hi bhejo
  → cards render (ProductImg = multi-format fallback)
```

### Teen actions (`routeAction` in `lib/intent.ts`)
| action | kab | cards |
|---|---|---|
| `chat` | hi / thanks / gaali / mol-bhaav / delivery / payment / MOQ / off-topic | **kabhi nahi** |
| `info` | "28x32 hai kya", "rate kya chal raha", "kaun se size hain" | sirf style number par |
| `show` | "dikhao", "photo bhejo", "aur dikhao", "26x30 sasta" | haan |

Inse pehle teen special handler chalte hain (`route.ts` me, upar se neeche):
`isLastLotQuestion` ("ye kitne ka padega"), `parseOrderQty` ("20 pcs bana do"),
aur unknown style number.

### Ginti wale sawaal — text → SQL (`lib/sql.ts`)
"Kitne style hain", "kis size me sabse zyada maal", "ladies ka average rate" —
in sawaalon ka jawaab card nahi, **number** hai, aur regex filter ye bana hi nahi
sakta. Iske liye catalog ke upar ek in-memory SQL table (`alasql`) chalti hai:

```
jeans(style TEXT, size TEXT, rate NUMBER, gender TEXT, img TEXT)
```

Table `visible()` se banti hai — **Group A yahan tak pahunchta hi nahi**.

SQL do jagah se aata hai, isi tarteeb me:

1. **`templateSQL()` — LLM ke bina.** Rozmarra ke sawaal (total ginti, budget ke
   neeche ginti, size-wise breakdown, average, sabse sasta/mehnga) yahan fix
   query se bante hain. `WHERE` `parseIntentJS()` se aata hai — wahi purana
   source of truth. Isliye ek hi sawaal ka jawaab **har baar bilkul same**.
2. **LLM SQL — sirf bache hue ajeeb sawaal.** Groq ka free model reliable nahi
   hai (wahi sawaal par kabhi `COUNT(*)`, kabhi `COUNT(DISTINCT style)`), isliye
   use aakhri me rakha hai, aur `validateSQL()` ke peeche.

`validateSQL()` ke taale: SELECT se shuru ho, sirf `jeans` table, sirf wo 5
column (+ `AS` wale alias), har anjaan shabd reject (isi se `DROP` / `INTO FILE`
/ `ATTACH` / `UNION` apne aap block hain), koi `;` `--` `` ` `` `$`, aur `LIMIT`
zabardasti (max 200).

Cards **kabhi LLM ke output se nahi bante** — SQL ka `style|size` wapas asli
catalog row se match karke hi card jaata hai, aur 4 se zyada ho toh bilkul nahi.

Kuch bhi gadbad (Groq band, query reject, alasql error) → `answerWithSQL()` `null`
lauta deta hai aur purana deterministic raasta chal padta hai. Customer ko error
kabhi nahi dikhta.

**Gate** (`route.ts`): `show` action ko haath nahi lagaya — "sabse sasta dikhao"
par purani card wali chaal hi chalti hai. Sirf saaf ginti ("kitne design hain",
bina photo maange) `show` se cheen li jaati hai. MOQ ka "kitne piece **lena**
padega" FAQ ke paas hi rehta hai; "gents me kitne pcs **hain**" SQL ke paas
jaata hai (`ORDER_WORDS` isi ko alag karta hai).

### Card repeat na ho — teen guard
1. `shownKeys` — client har dikhaye card ka `style|size` bhejta hai, "aur dikhao"
   par naye pieces nikalte hain. Ek baar me max 8 card.
2. **Same-lot guard** — filter badla par result wahi nikla, toh photo dobara nahi
   jaati (`sameLotLine`). "aur sasta" par yahi bachata hai.
3. **Affirmation guard** — cards dikhne ke baad "haan / theek hai / ok" ka matlab
   haami hai, naye photo ki demand nahi (`ackAfterCards`). Isliye
   `botOfferedToShow` me "👇" match **mat** karna — wo har card reply me hota hai.

### Purana filter naye sawaal par na chipke
`Intent` me `saidSize` / `saidRate` batate hain ki field ISI message me boli gayi
ya pichhle se carry hui. `checkAvailability()` ka relaxation ladder **pehle purani
field chhodta hai**, phir taaza wali. Isi se "500 wale gents dikhao" par 3 message
purana `28X32` hat jaata hai. `isCatalogQuestion()` ("kaun kaun se size hain")
size+rate dono reset kar deta hai.

### Jab maal na mile
Ladder: purani field → budget → doosri category (gender) → size → sab kuch.
Jo cards jaate hain reply unhi ke bare me hota hai, kabhi mismatch nahi.
Budget **upar** hai ya **neeche** — dono ka jawaab alag hai.

### Groq band ho toh?
Sab kuch chalta rahega — `polish()` seedha draft lauta deta hai. Drafts already
2-3 line ke human Hinglish jawaab hain. Ginti wale sawaal bhi chalte rahenge,
kyunki `templateSQL()` ko LLM ki zaroorat hi nahi.

## Intent tuning
`lib/intent.ts` — naye patterns yahan add karo:
- `routeAction` → naya chat/show signal
- `parseIntentJS` → naya filter (color, fit)
- `detectFAQ` → naya business sawaal
- `availabilityAnswer` → "maal nahi hai" ka naya tarika

`lib/sql.ts` — ginti wale sawaal:
- `AGG` / `isCountQuestion` → naya analytics signal
- `templateSQL` → naya fix sawaal (LLM ke bina, isi ko pehle try karo)
- `fmtCell` → naye column ka Hinglish label ("183 design" vs "249 pcs")

## Stack
Next 16 (Turbopack) · React 19 · Tailwind 4 · TypeScript 7 · alasql 4

Tailwind 4 CSS-first hai — koi `tailwind.config.ts` nahi. Theme badalna ho toh
`app/globals.css` me `@import "tailwindcss";` ke neeche `@theme { ... }` likho.
PostCSS plugin `@tailwindcss/postcss` hai, aur autoprefixer usi ke andar built-in
hai (alag package ki zaroorat nahi).

`next.config.js` me `serverExternalPackages: ["alasql"]` zaroori hai — alasql ke
andar react-native ke optional require hain, bundle karne par build tootti hai.
