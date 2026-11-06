import { NEAR } from "./config";

/** The factory's own rule: 2-32 of a-z 0-9 - _, starting and ending with a letter or digit, no doubled separators. */
export const validVaultName = (name: string) => /^[a-z0-9](?:[a-z0-9]|[-_](?=[a-z0-9])){1,31}$/.test(name);

export const factoryVaultId = (name: string) => `${name}.${NEAR.factory}`;

/** A vault Kite's factory made: `<name>.<factory>`, with a name the factory would accept. */
export function isFactoryVault(id: string): boolean {
  const suffix = `.${NEAR.factory}`;
  return id.endsWith(suffix) && validVaultName(id.slice(0, -suffix.length));
}
