import { getYields } from "@/lib/yields";

/** GET /api/yields → live APY per earning asset, from Meta Pool, Lido, Morpho and Kamino. */
export async function GET() {
  return Response.json(await getYields(), { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
