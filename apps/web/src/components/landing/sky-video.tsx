"use client";

import { useEffect, useRef } from "react";

/**
 * Background sky footage (Mixkit, free licence). Paused for people who
 * prefer reduced motion; the poster frame stands in.
 */
export function SkyVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (query.matches) video.pause();
      else video.play().catch(() => {});
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <video
      ref={ref}
      className="absolute inset-0 h-full w-full object-cover"
      poster="/media/sky-poster.jpg"
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
    >
      <source src="/media/sky.webm" type="video/webm" />
      <source src="/media/sky.mp4" type="video/mp4" />
    </video>
  );
}
