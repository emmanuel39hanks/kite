import { getLivePrices } from "@/lib/server/oneclick";

/** GET /api/prices → live USD prices for Kite's assets from NEAR Intents. */
export async function GET() {
  const data = await getLivePrices();
  return Response.json(data, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
}
