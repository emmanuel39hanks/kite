"use client";

import { useEffect, useState } from "react";
import { Wordmark } from "@/components/kite-mark";

const LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#plans", label: "Plans" },
  { href: "#earn", label: "Earn" },
  { href: "#safety", label: "Safety" },
  { href: "#faq", label: "FAQ" },
];

/**
 * Full-width and transparent over the hero; once you scroll it tightens into
 * a floating white bar with small corners and stays pinned to the top.
 */
export function SiteNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3 sm:px-5">
      <header
        className={`flex w-full items-center justify-between transition-all duration-300 ease-out ${
          scrolled
            ? "max-w-[920px] rounded-xl border border-black/[0.08] bg-white/85 py-2 pr-2 pl-4 shadow-[0_12px_32px_-16px_rgba(0,0,0,0.25)] backdrop-blur-xl"
            : "max-w-[1320px] rounded-xl border border-transparent py-3 pr-1 pl-2 sm:px-5"
        }`}
      >
        <a href="#top" aria-label="Kite home" className={scrolled ? "text-[24px]" : "text-[30px]"}>
          <Wordmark />
        </a>
        <nav className="hidden items-center gap-7 text-[15px] font-medium md:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:opacity-60">
              {l.label}
            </a>
          ))}
        </nav>
        <a
          href="/console"
          className="rounded-lg bg-black px-4 py-2.5 text-[15px] font-medium text-white hover:bg-black/80"
        >
          Get started
        </a>
      </header>
    </div>
  );
}
