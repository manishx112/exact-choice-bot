"use client";
import { useState, useRef, useEffect } from "react";
import { Jean, Intent } from "@/lib/types";

const IMG_MODE = process.env.NEXT_PUBLIC_IMG_MODE || "public";

// public files ke liye multiple formats try karega; proxy mode me apna route.
function imgUrls(id: string): string[] {
  if (!id) return [];
  if (IMG_MODE === "proxy") return [`/api/img?id=${id}`];
  return [
    `https://lh3.googleusercontent.com/d/${id}=w400`,
    `https://drive.google.com/thumbnail?id=${id}&sz=w400`,
    `https://drive.google.com/uc?export=view&id=${id}`,
  ];
}

interface Msg {
  role: "user" | "bot";
  text: string;
  cards?: Jean[];
}

function ProductImg({ id, style }: { id: string; style: number | string }) {
  const urls = imgUrls(id);
  const [idx, setIdx] = useState(0);
  const dead = idx >= urls.length || urls.length === 0;
  if (dead)
    return <div className="text-amber-300 text-4xl h-full flex items-center justify-center">👖</div>;
  return (
    <img
      src={urls[idx]}
      alt={`Style ${style}`}
      referrerPolicy="no-referrer"
      onError={() => setIdx((i) => i + 1)}
      className="h-full w-full object-cover"
    />
  );
}

function Card({ r }: { r: Jean }) {
  return (
    <div className="bg-white rounded-xl overflow-hidden border border-amber-100 shadow-sm w-36 flex-shrink-0">
      <div className="h-40 bg-amber-50 flex items-center justify-center overflow-hidden relative">
        <ProductImg id={r.img} style={r.s} />
      </div>
      <div className="p-2">
        <div className="flex items-baseline justify-between">
          <span className="font-bold text-gray-800 text-sm">#{r.s}</span>
          <span className="text-xs text-gray-400">Gr {r.g}</span>
        </div>
        <div className="text-amber-600 font-extrabold text-lg leading-tight">₹{r.rate}</div>
        <div className="text-[11px] text-gray-500">{r.size}</div>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const isUser = m.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div className={`max-w-[85%] ${isUser ? "order-2" : ""}`}>
        <div
          className={`px-4 py-2 rounded-2xl text-sm ${
            isUser
              ? "bg-amber-500 text-white rounded-br-sm"
              : "bg-white text-gray-800 rounded-bl-sm border border-amber-100"
          }`}
        >
          {m.text}
        </div>
        {m.cards && m.cards.length > 0 && (
          <div className="flex gap-2 mt-2 overflow-x-auto pb-1 no-scrollbar">
            {m.cards.map((r, i) => (
              <Card key={i} r={r} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "bot",
      text:
        'Namaste bhaiya! 🙏 John DV Jeans Wholesale me aapka swagat hai. Konsa size aur kis rate range me jeans lot chahiye? (jaise: "28x32 me 300 range wale dikha do")',
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastIntent, setLastIntent] = useState<Intent | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async () => {
    const q = input.trim();
    if (!q || loading) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setLoading(true);
    try {
      // Build chat history from last 6 messages for context
      const recentMsgs = [...messages, { role: "user" as const, text: q }];
      const history = recentMsgs.slice(-6).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, prevIntent: lastIntent, history }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "bot", text: data.reply, cards: data.cards }]);
      if (data.intent) setLastIntent(data.intent);
    } catch {
      setMessages((m) => [...m, { role: "bot", text: "Bhaiya network slow lag raha hai 😅 ek baar dobara bhejiye." }]);
    } finally {
      setLoading(false);
    }
  };

  const chips = ["28x32 me 300 range", "26x30 sabse sasta", "32x40 stock me", "28x34 under 460"];

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-gradient-to-b from-amber-50 to-orange-50 flex justify-center sm:items-center sm:p-6">
      <div className="w-full sm:max-w-lg md:max-w-xl bg-orange-50 sm:rounded-2xl shadow-xl overflow-hidden flex flex-col h-[100dvh] sm:h-[85dvh] sm:max-h-[720px]">
        <div
          className="bg-gradient-to-r from-amber-500 to-orange-600 text-white px-4 py-3 flex items-center gap-3 shrink-0"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="relative w-10 h-10 shrink-0">
            <div className="w-10 h-10 rounded-full bg-white p-0.5 flex items-center justify-center overflow-hidden shadow-inner">
              <img src="/avatar.svg" alt="John DV Logo" className="w-full h-full object-contain" />
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-400 border-2 border-orange-600 rounded-full"></span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold leading-tight truncate">John DV — Jeans Wholesale Expert</div>
            <div className="text-[11px] text-amber-100">Online</div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 chat-scroll">
          {messages.map((m, i) => (
            <Bubble key={i} m={m} />
          ))}
          {loading && (
            <div className="flex justify-start mb-3">
              <div className="bg-white border border-amber-100 px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm text-gray-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce"></span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="shrink-0 border-t border-amber-100 bg-orange-50">
          <div className="px-3 pt-2 flex gap-1.5 overflow-x-auto no-scrollbar">
            {chips.map((c) => (
              <button
                key={c}
                onClick={() => setInput(c)}
                className="shrink-0 text-[11px] bg-white border border-amber-200 text-amber-700 px-2.5 py-1 rounded-full hover:bg-amber-100 active:scale-95 transition"
              >
                {c}
              </button>
            ))}
          </div>

          <div
            className="p-3 flex gap-2 items-end"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Size aur rate range bataiye bhaiya..."
              rows={1}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
              className="flex-1 min-w-0 px-4 py-2.5 rounded-2xl border border-amber-200 text-base sm:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none overflow-y-auto leading-snug"
              style={{ maxHeight: "120px" }}
            />
            <button
              onClick={send}
              disabled={loading}
              className="bg-amber-500 hover:bg-amber-600 active:scale-95 disabled:opacity-50 text-white w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition"
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
