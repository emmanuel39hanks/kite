"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useWallet } from "@/lib/near/wallet";
import { usePreviewActions } from "@/lib/preview/actions";

/** A thin strip on every console page while preview mode is on. */
export function PreviewBar() {
  const w = useWallet();
  const pv = usePreviewActions();
  const router = useRouter();
  return (
    <>
      <Suspense>
        <PreviewFromUrl />
      </Suspense>
      {w.preview && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-black/[0.06] bg-[#f5f5f7] px-5 py-2.5 text-[13px] text-black sm:px-7">
          <span className="flex items-center gap-2 font-medium">
            <span className="h-2 w-2 rounded-full bg-[linear-gradient(#b9defe,#8cc6f6)] ring-1 ring-black/10" aria-hidden />
            Preview
          </span>
          <span className="order-last basis-full text-[#909090] sm:order-none sm:min-w-0 sm:flex-1 sm:basis-auto">
            Live prices and real NEAR Intents quotes. Your vault and wallet are simulated in this browser, and nothing is signed or sent.
          </span>
          <span className="ml-auto flex gap-3 sm:ml-0">
            <button
              type="button"
              className="cursor-pointer underline-offset-2 hover:underline"
              onClick={() => {
                pv.restart();
                router.push("/console");
              }}
            >
              Start over
            </button>
            <button type="button" className="cursor-pointer font-medium underline-offset-2 hover:underline" onClick={w.signIn}>
              Use a real wallet
            </button>
          </span>
        </div>
      )}
    </>
  );
}

/** /console?preview=1 turns preview on, so the README and landing page can link straight in. */
function PreviewFromUrl() {
  const params = useSearchParams();
  const w = useWallet();
  const want = params.get("preview") === "1";
  useEffect(() => {
    if (want && !w.preview) w.startPreview();
  }, [want, w]);
  return null;
}
