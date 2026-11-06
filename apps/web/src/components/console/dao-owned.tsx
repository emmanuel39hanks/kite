"use client";

import { foreignOwner, notOwnerMessage } from "@/lib/near/dao-view";
import { useWallet } from "@/lib/near/wallet";
import { useKite } from "@/lib/store";
import { Icon } from "./icons";
import { Button, Card } from "./ui";

/** The account that owns the connected wallet's vault, when that isn't the wallet itself (a DAO has accepted it). */
export function useForeignOwner(): string | null {
  const w = useWallet();
  const k = useKite();
  if (w.preview) return null;
  return foreignOwner(k.portfolio?.owner, k.account);
}

export const daoViewHref = (vault: string) => `/console/dao?vault=${encodeURIComponent(vault)}`;

/** Shown in place of owner controls once the vault belongs to someone else. */
export function DaoOwnedNotice({ owner, vault, className = "" }: { owner: string; vault: string; className?: string }) {
  return (
    <Card className={`flex flex-wrap items-center gap-4 p-4 ${className}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
        <Icon name="users" size={20} />
      </span>
      <p className="min-w-0 flex-1 text-[14px] leading-5">{notOwnerMessage(owner)}</p>
      <Button size="sm" href={daoViewHref(vault)} iconRight="arrow-right">
        Open the DAO view
      </Button>
    </Card>
  );
}
