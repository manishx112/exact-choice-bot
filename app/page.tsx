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
  const soldOut = r.stock === 0;
  return (
    <div className="bg-white rounded-xl overflow-hidden border border-amber-100 shadow-sm w-36 flex-shrink-0">
      <div className="h-40 bg-amber-50 flex items-center justify-center overflow-hidden relative">
        <ProductImg id={r.img} style={r.s} />
        {soldOut && (
          <span className="absolute top-1 left-1 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded">
            Out
          </span>
        )}
      </div>
      <div className="p-2">
        <div className="flex items-baseline justify-between">
          <span className="font-bold text-gray-800 text-sm">#{r.s}</span>
          <span className="text-xs text-gray-400">Gr {r.g}</span>
        </div>
        <div className="text-amber-600 font-extrabold text-lg leading-tight">₹{r.rate}</div>
        <div className="text-[11px] text-gray-500">
          {r.size} · {r.stock == null ? "stock —" : r.stock > 0 ? `${r.stock} pcs` : "0 pcs"}
        </div>
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
        'Sat Sri Akaal paaji 🙏 John DV te tuhada swagat! Dasso — konsa size te kinne rate de jeans chahide? (jaise: "28x32 me 300 range wale dikha do")',
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
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, prevIntent: lastIntent }),
      });
      const data = await res.json();
      setMessages((m) => [...m, { role: "bot", text: data.reply, cards: data.cards }]);
      if (data.intent) setLastIntent(data.intent); // greeting/chit-chat turns na overwrite kare context
    } catch {
      setMessages((m) => [...m, { role: "bot", text: "Oye net thoda slow hai 😅 dobara bhejo." }]);
    } finally {
      setLoading(false);
    }
  };

  const chips = ["28x32 me 300 range", "26x30 sabse sasta", "32x40 stock me", "28x34 under 460"];

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-amber-50 to-orange-50 flex items-center justify-center sm:p-4">
      <div className="w-full max-w-md bg-orange-50 sm:rounded-2xl shadow-xl overflow-hidden flex flex-col h-[100dvh] sm:h-[640px]">
        <div className="bg-gradient-to-r from-amber-500 to-orange-600 text-white px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-xl">👳</div>
          <div className="flex-1">
            <div className="font-bold leading-tight">John DV — Jeans Wala Paaji</div>
            <div className="text-[11px] text-amber-100 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-300 rounded-full inline-block"></span>
              Online
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 chat-scroll">
          {messages.map((m, i) => (
            <Bubble key={i} m={m} />
          ))}
          {loading && (
            <div className="flex justify-start mb-3">
              <div className="bg-white border border-amber-100 px-4 py-2 rounded-2xl rounded-bl-sm text-sm text-gray-400">
                type kar raha hai…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="px-3 pb-1 flex gap-1.5 flex-wrap">
          {chips.map((c) => (
            <button
              key={c}
              onClick={() => setInput(c)}
              className="text-[11px] bg-white border border-amber-200 text-amber-700 px-2 py-1 rounded-full hover:bg-amber-100"
            >
              {c}
            </button>
          ))}
        </div>

        <div className="p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Size te rate likho paaji..."
            className="flex-1 px-4 py-2 rounded-full border border-amber-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            onClick={send}
            disabled={loading}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white w-10 h-10 rounded-full flex items-center justify-center"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}
