import type { Metadata } from "next";
import { ConsoleShell } from "@/components/console/shell";
import { LiveSync } from "@/lib/near/live";
import { WalletProvider } from "@/lib/near/wallet";
import { KiteProvider } from "@/lib/store";

export const metadata: Metadata = {
  title: "Kite Console",
};

export default function ConsoleLayout({ children }: LayoutProps<"/console">) {
  return (
    <WalletProvider>
      <KiteProvider>
        <LiveSync />
        <ConsoleShell>{children}</ConsoleShell>
      </KiteProvider>
    </WalletProvider>
  );
}
