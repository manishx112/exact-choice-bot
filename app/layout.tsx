import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "John DV — Jeans Wala Paaji",
  description: "Chat support for John DV jeans",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
