import { ONECLICK } from "@/lib/oneclick";

/** GET ?address=… → 1Click swap status (PENDING_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED…). */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address) return Response.json({ error: "address required" }, { status: 400 });
  const r = await fetch(`${ONECLICK}/status?depositAddress=${encodeURIComponent(address)}`, { cache: "no-store" });
  return Response.json(await r.json(), { status: r.ok ? 200 : 502 });
}
