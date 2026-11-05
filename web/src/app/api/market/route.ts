import { getMarket } from "@/lib/market/market";

/** GET /api/market → live prices (NEAR Intents) and 24h change (CoinGecko). */
export async function GET() {
  return Response.json(await getMarket(), { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
