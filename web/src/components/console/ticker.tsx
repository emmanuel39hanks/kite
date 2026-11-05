"use client";

import { Logo } from "@/components/logo";
import { ASSETS, price as fmtPrice } from "@/lib/assets";
import { useMarket } from "@/lib/market/use-market";
import { Change } from "./ui";

/** Live price ticker: NEAR Intents prices, CoinGecko 24h change. Pauses on hover. */
export function Ticker() {
  const { quote } = useMarket();
  const items = ASSETS.filter((a) => a.live && !a.earn);
  const row = (hidden: boolean) => (
    <div className="flex shrink-0 items-center gap-3 pr-3" aria-hidden={hidden || undefined}>
      {items.map((a) => {
        const q = quote(a.id);
        return (
          <div key={a.id} className="flex shrink-0 items-center gap-3 rounded-[20px] bg-[#f5f5f7] px-5 py-4 text-[14px]">
            <Logo id={a.id} size={24} />
            <span className="font-medium">{a.ticker}</span>
            <span className="tabular-nums">{fmtPrice(q.price)}</span>
            <Change value={q.change24h} />
          </div>
        );
      })}
    </div>
  );
  return (
    <div className="group flex overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
      <div className="flex animate-[kite-marquee_40s_linear_infinite] group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
