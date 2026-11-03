import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";

const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "800"],
});

export const metadata: Metadata = {
  title: "Kite: a self-custodied portfolio that rebalances itself",
  description:
    "One account for Bitcoin, Ethereum, Solana, tokenized stocks and gold. Kite rebalances on your schedule through NEAR Intents, with an agent that can trade but never withdraw.",
};

export const viewport: Viewport = {
  themeColor: "#fcfcfd",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${hanken.variable} antialiased`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
