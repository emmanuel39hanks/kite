import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Wordmark } from "@/components/kite-mark";
import { Verifier } from "./verifier";

export const metadata: Metadata = {
  title: "Check a Kite policy proposal",
  description: "Check, in your own browser, that a DAO proposal's rationale came from NEAR AI unedited, and that its vault calls are the ones the analysis was about.",
};

export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-[760px] px-4 pb-20 sm:px-6">
      <header className="flex items-center justify-between py-6">
        <Link href="/" aria-label="Kite home">
          <Wordmark className="text-[24px]" />
        </Link>
        <span className="text-[13px] text-[#6b6b6b]">No wallet needed</span>
      </header>
      <h1 className="pt-4 pb-2 text-[30px] leading-9 tracking-[-0.05em]">Check a policy proposal</h1>
      <p className="max-w-[62ch] text-[14px] leading-5 text-[#6b6b6b]">
        A Kite treasury policy proposal carries NEAR AI&apos;s signed answer in its last line. This page checks it here in your browser: the signature, the bytes it covers, whether NEAR AI&apos;s
        current TEE report includes the signing key, that the model was asked Kite&apos;s own question, and that the vault calls are the ones the analysis was about. Anything it can&apos;t check is marked as not checked.
      </p>
      <Suspense fallback={null}>
        <Verifier />
      </Suspense>
    </main>
  );
}
