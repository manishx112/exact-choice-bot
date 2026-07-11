// Server-side image proxy. Browser se seedha Drive maangne pe jo 403 aata hai
// (Workspace org-share ya referrer/throttle) wo yahan bypass ho jaata hai,
// kyunki request tere Next.js server se jaati hai — browser se nahi.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// public file ke liye ye formats server-side reliably bytes dete hain
function driveCandidates(id: string): string[] {
  return [
    `https://drive.google.com/thumbnail?id=${id}&sz=w600`, // sabse reliable, no interstitial
    `https://lh3.googleusercontent.com/d/${id}=w600`,
    `https://drive.google.com/uc?export=download&id=${id}`,
  ];
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return new NextResponse("no id", { status: 400 });

  for (const url of driveCandidates(id)) {
    try {
      const r = await fetch(url, { redirect: "follow", cache: "no-store" });
      const type = r.headers.get("content-type") || "";
      // sirf tab accept karo jab sach me image mile (HTML error page nahi)
      if (r.ok && type.startsWith("image/")) {
        const buf = await r.arrayBuffer();
        return new NextResponse(buf, {
          headers: {
            "Content-Type": type,
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
          },
        });
      }
    } catch {
      // agla format try karo
    }
  }
  return new NextResponse("img not accessible", { status: 404 });
}
