# John DV — Delhi Jeans Wholesale Chat Support (Next.js)

Delhi/UP wholesale expert persona jeans chat bot. Size + rate samajh ke live sheet data se
product cards dikhata hai. Data ka source-of-truth deterministic filter hai
(LLM sirf intent nikaalta hai, price/style kabhi hallucinate nahi hota).

## Setup
```bash
npm install
cp .env.example .env.local   # values bhar do
npm run dev                  # http://localhost:3000
```

## Env
- `APPS_SCRIPT_URL` — tera Apps Script web-app URL (data source)
- `GROQ_API_KEY` — optional. Na ho toh JS parser chalega (free, instant).
- `NEXT_PUBLIC_IMG_MODE` — `public` (Drive public link) ya `proxy` (private-safe)

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
```
page.tsx (chat UI)
  → POST /api/chat
      → fetch APPS_SCRIPT_URL (fresh data)
      → intent: Groq (JSON-only) OR parseIntentJS
      → filterData()  ← SOURCE OF TRUTH
      → personaLine()
  → cards render (ProductImg = multi-format fallback)
```

## Intent tuning
`lib/intent.ts` me `parseIntentJS` aur Groq prompt dono hain.
Naye patterns (color, fit, group A/B filter) yahin add karo.
