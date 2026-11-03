/** Text-only wordmark: "Kite", heavy weight, tight tracking. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-extrabold tracking-[-0.06em] leading-none ${className}`}
    >
      Kite
    </span>
  );
}
