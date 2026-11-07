"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/console/icons";
import { NEAR } from "@/lib/near/config";
import { pickMyVault, useMyVault } from "@/lib/near/my-vault";
import { useWallet } from "@/lib/near/wallet";
import { useKite } from "@/lib/store";

const short = (v: string) => v.replace(`.${NEAR.factory}`, "");

/**
 * The page title on Home. With more than one vault (yours, or your DAOs'), it opens a list to switch between them;
 * with one it's just the name.
 */
export function VaultSwitcher({ title }: { title: string }) {
  const router = useRouter();
  const w = useWallet();
  const k = useKite();
  const mine = useMyVault(w.preview ? null : w.accountId);
  const count = (mine?.open.length ?? 0) + (mine?.daoVaults.length ?? 0);
  const isDao = !!mine?.daoVaults.some((d) => d.vault === mine.vault);
  const badge = (
    <span className="grid h-9 w-9 place-items-center rounded-xl bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)] ring-1 ring-inset ring-black/[0.06]">
      <Icon name={isDao ? "dao" : "wallet"} size={17} />
    </span>
  );
  if (!mine || !w.accountId || count < 2)
    return isDao ? (
      <span className="flex items-center gap-2.5">
        {badge}
        {title}
      </span>
    ) : (
      <>{title}</>
    );
  const item = "flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] outline-none data-[highlighted]:bg-[#f5f5f7]";
  const tick = (on: boolean) => (
    <span className={`grid h-[17px] w-[17px] shrink-0 place-items-center ${on ? "text-[#05a800]" : "text-transparent"}`}>
      <Icon name="check" size={15} />
    </span>
  );
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button type="button" className="group flex cursor-pointer items-center gap-2.5 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[#8cc6f6]">
          {badge}
          <span>{title}</span>
          <Icon name="chevron-down" size={18} className="text-black/40 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={8} className="z-50 min-w-[280px] rounded-2xl bg-white p-1.5 outline-none shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5">
          {mine.open.length > 0 && <div className="px-3 pt-1.5 pb-1 text-[12px] text-[#6b6b6b]">Personal</div>}
          {mine.open.map((v) => (
            <Menu.Item key={v} onSelect={() => pickMyVault(w.accountId!, v)} className={item}>
              {tick(v === mine.vault)}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate">{k.names[v]?.name ?? "My vault"}</span>
                <span className="block truncate font-mono text-[11px] text-[#6b6b6b]">{short(v)}</span>
              </span>
            </Menu.Item>
          ))}
          {mine.daoVaults.length > 0 && <div className="px-3 pt-2.5 pb-1 text-[12px] text-[#6b6b6b]">DAO</div>}
          {mine.daoVaults.map((d) => (
            <Menu.Item key={d.vault} onSelect={() => pickMyVault(w.accountId!, d.vault)} className={item}>
              {tick(d.vault === mine.vault)}
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate">{short(d.vault)}</span>
                <span className="block truncate text-[11px] text-[#6b6b6b]">{d.dao}</span>
              </span>
            </Menu.Item>
          ))}
          <Menu.Separator className="my-1 h-px bg-black/[0.06]" />
          <Menu.Item
            onSelect={() => {
              pickMyVault(w.accountId!, "new");
              router.push("/console/explore");
            }}
            className={item}
          >
            <span className="grid h-[17px] w-[17px] place-items-center text-black/55">
              <Icon name="plus" size={15} />
            </span>
            New personal vault
          </Menu.Item>
          <Menu.Item onSelect={() => router.push("/console/dao")} className={item}>
            <span className="grid h-[17px] w-[17px] place-items-center text-black/55">
              <Icon name="dao" size={15} />
            </span>
            New DAO vault
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
