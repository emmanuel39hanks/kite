"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as Menu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Wordmark } from "@/components/kite-mark";
import { Logo } from "@/components/logo";
import { ASSETS } from "@/lib/assets";
import { accountUrl, vaultIdFor } from "@/lib/near/config";
import { useWallet } from "@/lib/near/wallet";
import { PLAN_DATA } from "@/lib/plans";
import { useKite } from "@/lib/store";
import { Icon, type IconName } from "./icons";
import { PreviewBar } from "./preview-bar";
import { Avatar, Badge, Button } from "./ui";
import { usePreviewActions } from "@/lib/preview/actions";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/console", label: "Home", icon: "dashboard" },
  { href: "/console/explore", label: "Explore", icon: "explore" },
  { href: "/console/earn", label: "Earn", icon: "up" },
  { href: "/console/create", label: "Create", icon: "create" },
  { href: "/console/activity", label: "Activity", icon: "list" },
];
const NAV_BOTTOM: { href: string; label: string; icon: IconName }[] = [
  { href: "/console/guardrails", label: "Guardrails", icon: "shield" },
  { href: "/#faq", label: "Help", icon: "help" },
];

export function ConsoleShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const active = (href: string) => (href === "/console" ? path === href : path.startsWith(href));

  if (path.startsWith("/console/start")) return <div className="min-h-dvh bg-[#fcfcfd]">{children}</div>;

  return (
    <div className="min-h-dvh bg-[#fcfcfd] text-black">
      <TopBar />
      <PreviewBar />
      <div className="flex">
        <aside className="sticky top-[80px] hidden h-[calc(100dvh-80px)] w-[18rem] shrink-0 flex-col border-r border-black/[0.06] p-4 lg:flex">
          <nav className="flex flex-1 flex-col gap-1.5">
            {NAV.map((n) => (
              <NavItem key={n.href} {...n} active={active(n.href)} />
            ))}
          </nav>
          <nav className="flex flex-col gap-1.5">
            {NAV_BOTTOM.map((n) => (
              <NavItem key={n.href} {...n} active={active(n.href)} />
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <nav className="flex gap-1 overflow-x-auto border-b border-black/[0.06] px-4 py-2 lg:hidden">
            {[...NAV, NAV_BOTTOM[0]].map((n) => (
              <Link key={n.href} href={n.href} className={`shrink-0 rounded-full px-3.5 py-2 text-[14px] ${active(n.href) ? "bg-black text-white" : "text-black/55"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 sm:px-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

function NavItem({ href, label, icon, active }: { href: string; label: string; icon: IconName; active: boolean }) {
  return (
    <Link
      href={href}
      className={`flex h-12 items-center gap-3 rounded-full px-3 text-[16px] tracking-[-0.02em] transition-colors ${
        active ? "text-black" : "text-black/[0.56] hover:bg-black/[0.03] hover:text-black"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <Icon name={icon} size={24} stroke={1.4} />
      {label}
    </Link>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-40 flex h-[80px] items-center justify-between gap-4 border-b border-black/[0.06] bg-[#fcfcfd]/90 pr-3.5 pl-5 backdrop-blur-xl sm:pl-7">
      <Link href="/console" aria-label="Kite home" className="flex items-center gap-2">
        <Wordmark className="text-[28px]" />
      </Link>
      <div className="absolute left-1/2 hidden w-full max-w-[400px] -translate-x-1/2 md:block">
        <SearchButton />
      </div>
      <AccountArea />
    </header>
  );
}

/* ───────────── Search ───────────── */

function SearchButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex h-12 w-full cursor-pointer items-center gap-3 rounded-3xl bg-white px-4 text-left ring-1 ring-inset ring-black/[0.06] shadow-[0_0_6px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)]"
        >
          <Icon name="search" size={20} />
          <span className="flex-1 text-[14px] tracking-[-0.02em] text-[#c4c4c4]">Search assets and plans…</span>
          <kbd className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[11px] text-black/40">⌘K</kbd>
        </button>
      </Dialog.Trigger>
      <SearchDialog onClose={() => setOpen(false)} />
    </Dialog.Root>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    const plans = PLAN_DATA.filter((p) => !t || p.name.toLowerCase().includes(t) || p.who.toLowerCase().includes(t)).map((p) => ({
      key: p.slug,
      label: p.name,
      sub: p.comingSoon ? "Plan · coming soon" : "Plan",
      href: `/console/explore/${p.slug}`,
      logo: p.mix[0].id,
    }));
    const assets = ASSETS.filter((a) => !t || a.name.toLowerCase().includes(t) || a.ticker.toLowerCase().includes(t)).map((a) => ({
      key: a.id,
      label: a.name,
      sub: a.live ? `${a.ticker} · ${a.kind}` : `${a.ticker} · coming soon`,
      href: `/console/explore#assets`,
      logo: a.id,
    }));
    return [...plans, ...assets].slice(0, 8);
  }, [q]);
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]" />
      <Dialog.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100%-32px)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-3xl bg-white shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)] ring-1 ring-black/5 outline-none">
        <Dialog.Title className="sr-only">Search</Dialog.Title>
        <div className="flex items-center gap-3 border-b border-black/[0.06] px-5">
          <Icon name="search" size={20} className="text-black/50" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && results[0] && go(results[0].href)}
            placeholder="Search assets and plans…"
            className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-black/30"
          />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-4 py-6 text-center text-[14px] text-[#909090]">No matches.</li>}
          {results.map((r) => (
            <li key={`${r.sub}-${r.key}`}>
              <button type="button" onClick={() => go(r.href)} className="flex w-full cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-[#f5f5f7]">
                <Logo id={r.logo} size={30} />
                <span className="flex-1">
                  <span className="block text-[15px]">{r.label}</span>
                  <span className="block text-[12px] text-[#909090]">{r.sub}</span>
                </span>
                <Icon name="arrow-right" size={16} className="text-black/30" />
              </button>
            </li>
          ))}
        </ul>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

/* ───────────── Account ───────────── */

function AccountArea() {
  const router = useRouter();
  const w = useWallet();
  const k = useKite();
  const pv = usePreviewActions();
  const [copied, setCopied] = useState(false);
  if (!w.accountId) {
    return (
      <Button variant="primary" icon="wallet" onClick={w.signIn} disabled={!w.ready}>
        Connect wallet
      </Button>
    );
  }
  const short = w.accountId.length > 22 ? `${w.accountId.slice(0, 8)}…${w.accountId.slice(-8)}` : w.accountId;
  const vault = vaultIdFor(w.accountId);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          className="flex h-10 cursor-pointer items-center gap-2 rounded-full bg-[#fcfcfd] py-0 pr-1.5 pl-1.5 ring-1 ring-inset ring-black/[0.06] shadow-[0_0_6px_rgba(0,0,0,0.02),0_2px_2px_rgba(0,0,0,0.04)] outline-none"
        >
          <Avatar seed={w.accountId} />
          <span className="max-w-[160px] truncate text-[14px] tracking-[-0.02em]">{w.preview ? "Preview" : short}</span>
          <span className="grid h-6 w-6 place-items-center rounded-full bg-white shadow-[0_2px_2px_rgba(0,0,0,0.04)]">
            <Icon name="dots" size={14} className="text-[#909090]" />
          </span>
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[240px] rounded-2xl bg-white p-1.5 outline-none shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/5"
        >
          <div className="px-3 pt-2 pb-2.5">
            <div className="text-[12px] text-[#909090]">{w.preview ? "Previewing as" : "Signed in as"}</div>
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px]">{w.accountId}</span>
              {w.preview && <Badge>Simulated</Badge>}
            </div>
          </div>
          <Menu.Separator className="my-1 h-px bg-black/[0.06]" />
          <MenuItem icon="user" onSelect={() => router.push("/console/profile")}>
            My profile
          </MenuItem>
          {w.preview ? (
            <>
              <MenuItem
                icon="refresh"
                onSelect={() => {
                  pv.restart();
                  router.push("/console");
                }}
              >
                Start the preview over
              </MenuItem>
              <MenuItem icon="wallet" onSelect={w.signIn}>
                Use a real wallet
              </MenuItem>
              <MenuItem icon="logout" onSelect={w.exitPreview}>
                Leave preview
              </MenuItem>
            </>
          ) : (
            <>
          <MenuItem
            icon="copy"
            onSelect={() => {
              navigator.clipboard.writeText(w.accountId!).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? "Copied" : "Copy account"}
          </MenuItem>
          {k.vaultFound && (
            <MenuItem icon="external" onSelect={() => window.open(accountUrl(vault), "_blank")}>
              View vault on NearBlocks
            </MenuItem>
          )}
          <MenuItem icon="logout" onSelect={() => w.signOut()}>
            Disconnect
          </MenuItem>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function MenuItem({ icon, children, onSelect }: { icon: IconName; children: ReactNode; onSelect: () => void }) {
  return (
    <Menu.Item onSelect={onSelect} className="flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-[14px] outline-none data-[highlighted]:bg-[#f5f5f7]">
      <Icon name={icon} size={17} className="text-black/55" />
      {children}
    </Menu.Item>
  );
}
