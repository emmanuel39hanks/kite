import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PLAN_DATA, planBySlug } from "@/lib/plans";
import { StartFlow } from "./start-flow";

// "custom" uses the mix from Create a plan; "add-money" tops up an existing vault.
const SPECIAL = ["custom", "add-money"];

export function generateStaticParams() {
  return [...PLAN_DATA.map((p) => ({ slug: p.slug })), ...SPECIAL.map((slug) => ({ slug }))];
}

// Reading params is URL data under Cache Components, so it streams behind Suspense.
export default function StartPage({ params }: PageProps<"/console/start/[slug]">) {
  return (
    <Suspense fallback={null}>
      <Start params={params} />
    </Suspense>
  );
}

async function Start({ params }: { params: PageProps<"/console/start/[slug]">["params"] }) {
  const { slug } = await params;
  if (!SPECIAL.includes(slug) && !planBySlug(slug)) notFound();
  return <StartFlow slug={slug} />;
}
