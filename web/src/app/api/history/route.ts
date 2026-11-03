import { connection } from "next/server";
import { getHistory } from "@/lib/market";

const ALLOWED = [7, 30, 90, 365];

/** GET /api/history?days=365 → daily prices per asset, real data. */
export async function GET(req: Request) {
  await connection();
  const days = Number(new URL(req.url).searchParams.get("days") ?? 365);
  if (!ALLOWED.includes(days)) return Response.json({ error: "days must be 7, 30, 90 or 365" }, { status: 400 });
  const h = await getHistory(days).catch(() => null);
  if (!h) return Response.json({ error: "Price history is unavailable right now. Try again in a minute." }, { status: 503 });
  return Response.json(h, { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
