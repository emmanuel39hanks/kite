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
    "Your own vault on NEAR for Bitcoin, Ethereum, Solana, gold and dollars. Kite keeps the mix on target through NEAR Intents, with a key that can ask for a rebalance but never withdraw.",
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
