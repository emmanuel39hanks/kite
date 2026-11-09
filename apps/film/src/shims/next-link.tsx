import type { ReactNode } from "react";

/** next/link for the film: there's nowhere to navigate, so a plain anchor. */
export default function Link({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
