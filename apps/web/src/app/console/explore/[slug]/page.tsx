import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PLAN_DATA, planBySlug } from "@/lib/plans";
import { PlanDetail } from "./plan-detail";

export function generateStaticParams() {
  return PLAN_DATA.map((p) => ({ slug: p.slug }));
}

// Reading params is URL data under Cache Components, so it streams behind Suspense.
export default function PlanPage({ params }: PageProps<"/console/explore/[slug]">) {
  return (
    <Suspense fallback={null}>
      <Plan params={params} />
    </Suspense>
  );
}

async function Plan({ params }: { params: PageProps<"/console/explore/[slug]">["params"] }) {
  const { slug } = await params;
  if (!planBySlug(slug)) notFound();
  return <PlanDetail slug={slug} />;
}
