import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "John DV — Delhi Jeans Wholesale Expert",
  description: "Delhi wholesale jeans chat support for John DV",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  // Keeps the layout in sync with the on-screen keyboard on Android/Chrome
  // instead of letting the keyboard overlay content without resizing it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
