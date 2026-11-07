/** Network settings for the live console. Everything is mainnet: NEAR Intents has no testnet. */
export const NEAR = {
  networkId: "mainnet" as const,
  rpc: process.env.NEXT_PUBLIC_NEAR_RPC ?? "https://rpc.mainnet.fastnear.com",
  intents: "intents.near",
  explorer: "https://nearblocks.io",
  /** Public half of Kite's keeper key. Each vault adds it as a rebalance-only key. */
  agentPublicKey: process.env.NEXT_PUBLIC_KITE_AGENT_PK ?? "",
  /** Vault contract code served by this site; its hash is published in the README. */
  wasmUrl: "/vault/kite_vault.wasm",
  /** The factory's code, served so anyone can check the deployed factory against it. */
  factoryWasmUrl: "/vault/kite_factory.wasm",
  /** NEAR sent to the new vault account: storage for its ~233 KB of code plus state (~2.35 NEAR),
   *  and about 0.24 NEAR left over for Kite's rebalance gas. What's left after gas comes back via close_vault. */
  vaultStorageNear: "2.6",
  /** Kite's vault factory: creates `<name>.<factory>` vaults owned by whoever calls it, such as a DAO. Locked: no keys. */
  factory: process.env.NEXT_PUBLIC_KITE_FACTORY ?? "kitevaults.near",
  /** NEAR a factory vault starts with, from its creator: the same 2.6 NEAR as a vault made from a wallet. */
  factoryDepositNear: "2.6",
  /** Gas the agent key may burn before it must be renewed (turn the key off and on). */
  agentAllowanceNear: "0.25",
  /** USDC on NEAR: the hub asset deposits land in. */
  usdc: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  usdcContract: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
};

/** Live mode needs Kite's agent public key; without it the console stays in demo mode. */
export const liveAvailable = () => NEAR.agentPublicKey.startsWith("ed25519:");

export const vaultIdFor = (owner: string) => `kite.${owner}`;

export const txUrl = (hash: string) => `${NEAR.explorer}/txns/${encodeURIComponent(hash)}`;
export const accountUrl = (id: string) => `${NEAR.explorer}/address/${id}`;
/**
 * A DAO's page in Trezu, where members vote without paying gas (Trezu sponsors it). Trezu runs on SputnikDAO, so
 * only `*.sputnik-dao.near` DAOs have one; any other DAO votes from Kite itself.
 */
export const trezuUrl = (dao: string | null | undefined) => (dao && dao.endsWith(".sputnik-dao.near") ? `https://trezu.app/${encodeURIComponent(dao)}` : null);
