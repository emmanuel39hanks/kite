"use client";

import { Logo } from "@/components/logo";
import { useWallet } from "@/lib/near/wallet";
import { Icon } from "./icons";
import { Button, Card } from "./ui";

/** Shown wherever a page needs a NEAR account. */
export function ConnectGate({ title = "Connect your NEAR wallet", text }: { title?: string; text?: string }) {
  const w = useWallet();
  return (
    <Card className="overflow-hidden">
      <div className="grid items-center gap-8 p-8 sm:p-12 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="flex -space-x-2">
            {(["near", "btc", "eth", "xaut", "usdc"] as const).map((id) => (
              <Logo key={id} id={id} size={36} className="ring-2 ring-[#f5f5f7]" />
            ))}
          </div>
          <h2 className="mt-6 text-[34px] leading-[1.05] tracking-[-0.05em]">{title}</h2>
          <p className="mt-3 max-w-[46ch] text-[16px] leading-6 text-[#6b6b6b]">
            {text ?? "Your Kite vault is owned by your NEAR account. Connect to see your portfolio, or to create your vault in one signature."}
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <Button variant="primary" size="lg" icon="wallet" onClick={w.signIn} disabled={!w.ready} loading={!w.ready}>
              Connect wallet
            </Button>
            <Button size="lg" icon="play" onClick={w.startPreview}>
              Try the preview
            </Button>
          </div>
          <p className="mt-4 text-[13px] leading-5 text-[#6b6b6b]">
            HOT, Meteor, Intear, Sender, Nightly and OKX are supported. No wallet? The preview runs the whole flow with live prices and real NEAR Intents quotes, and never signs anything.
          </p>
        </div>
        <ul className="space-y-3">
          {[
            ["shield", "Your vault, your keys", "Only you can withdraw. Kite gets one key that can only rebalance."],
            ["explore", "Crypto and gold in one place", "Bitcoin, Ethereum, Solana, NEAR and Tether Gold, held through NEAR Intents."],
            ["refresh", "Kept on target", "Checked daily. Kite trades only when a holding drifts past your limit."],
          ].map(([icon, t, d]) => (
            <li key={t} className="flex gap-3 rounded-2xl bg-white p-4 shadow-[0_0_6px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)]">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-black/[0.04]">
                <Icon name={icon as "shield"} size={20} />
              </span>
              <div>
                <div className="text-[14px] font-medium">{t}</div>
                <p className="text-[13px] leading-5 text-[#6b6b6b]">{d}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
