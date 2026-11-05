import { clientIp, limited } from "@/lib/server/guards";
import { ONECLICK } from "@/lib/server/oneclick";

/** GET ?address=… → 1Click swap status (PENDING_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED…). */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") ?? "";
  // Deposit addresses are chain addresses: letters, digits and a few separators, never long.
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(address)) return Response.json({ error: "address required" }, { status: 400 });
  if (limited(`status:${clientIp(req)}`, 240, 10 * 60_000)) return Response.json({ error: "Too many requests" }, { status: 429 });
  try {
    const r = await fetch(`${ONECLICK}/status?depositAddress=${encodeURIComponent(address)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const d = await r.json().catch(() => ({ error: "Unreadable answer from NEAR Intents" }));
    return Response.json(d, { status: r.ok ? 200 : r.status === 404 ? 404 : 502 });
  } catch {
    return Response.json({ error: "NEAR Intents didn't answer" }, { status: 502 });
  }
}
