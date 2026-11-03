export type IconName =
  | "dashboard"
  | "explore"
  | "create"
  | "list"
  | "shield"
  | "help"
  | "search"
  | "deposit"
  | "external"
  | "dots"
  | "check"
  | "x"
  | "arrow-left"
  | "arrow-right"
  | "key"
  | "lock"
  | "clock"
  | "plus"
  | "trash"
  | "up"
  | "down"
  | "copy"
  | "logout"
  | "refresh"
  | "wallet"
  | "chevron-down"
  | "user"
  | "share"
  | "play";

const PATHS: Record<IconName, string> = {
  dashboard:
    "M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v1a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 7zM3.75 14.5A2.25 2.25 0 0 1 6 12.25h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18zM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v3.5A2.25 2.25 0 0 1 18 11.75h-2.25A2.25 2.25 0 0 1 13.5 9.5zM13.5 17a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 17v1A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18z",
  explore: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 21c2.5 0 4.5-4 4.5-9S14.5 3 12 3 7.5 7 7.5 12s2 9 4.5 9zM3.5 9h17M3.5 15h17",
  create:
    "M9.8 15.9 9 18.75l-.8-2.85a4.5 4.5 0 0 0-3.1-3.1L2.25 12l2.85-.8a4.5 4.5 0 0 0 3.1-3.1L9 5.25l.8 2.85a4.5 4.5 0 0 0 3.1 3.1l2.85.8-2.85.8a4.5 4.5 0 0 0-3.1 3.1zM18.26 8.71 18 9.75l-.26-1.04a2.25 2.25 0 0 0-1.45-1.45L15.25 7l1.04-.26a2.25 2.25 0 0 0 1.45-1.45L18 4.25l.26 1.04a2.25 2.25 0 0 0 1.45 1.45l1.04.26-1.04.26a2.25 2.25 0 0 0-1.45 1.45z",
  list: "M8.25 6.75h12M8.25 12h12M8.25 17.25h12M3.75 6.75h.01M3.75 12h.01M3.75 17.25h.01",
  shield: "M12 3l7.5 3v5.25c0 4.6-3.1 8.2-7.5 9.75-4.4-1.55-7.5-5.15-7.5-9.75V6zM9 12l2 2 4-4",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.25a2.5 2.5 0 1 1 3.6 2.25c-.7.35-1.1.85-1.1 1.5v.5M12 16.5h.01",
  search: "M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM15.5 15.5 20 20",
  deposit: "M12 3.5v10m0 0-4-4m4 4 4-4M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3",
  external: "M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10",
  dots: "M6 12h.01M12 12h.01M18 12h.01",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M6 6l12 12M18 6L6 18",
  "arrow-left": "M19 12H5M11 6l-6 6 6 6",
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  key: "M15.5 8.5a4 4 0 1 1-1.2-2.8M14.3 5.7 21 12.4V15h-2.6v-2.4H16V10",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  up: "M3.5 15.5 9 10l3.5 3.5L20.5 6M15 6h5.5v5.5",
  down: "M3.5 8.5 9 14l3.5-3.5 8 7.5M15 18h5.5v-5.5",
  copy: "M8 8V5.5A1.5 1.5 0 0 1 9.5 4h9A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H16M5.5 8h9A1.5 1.5 0 0 1 16 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 18.5v-9A1.5 1.5 0 0 1 5.5 8z",
  logout: "M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15M10 16l4-4-4-4M14 12H4",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  wallet: "M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5v10A2.5 2.5 0 0 0 6.5 20H20V8H6.5A2.5 2.5 0 0 1 4 7.5zM16 14h.01",
  "chevron-down": "M6 9l6 6 6-6",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20a7.5 7.5 0 0115 0",
  share: "M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4",
  play: "M8 5.5v13a.5.5 0 00.76.43l10.5-6.5a.5.5 0 000-.86L8.76 5.07A.5.5 0 008 5.5z",
};

export function Icon({ name, size = 20, className = "", stroke = 1.6 }: { name: IconName; size?: number; className?: string; stroke?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "dots" ? 3 : stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
