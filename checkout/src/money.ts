// Pure money helpers. Kept dependency-free so they can be unit-tested with plain Node.

/** USD (whole or fractional) -> token minor units with 6 decimals, as a safe integer. */
export function usdToUnits(usd: number, decimals = 6): number {
  const units = Math.round(usd * 10 ** decimals);
  if (!Number.isSafeInteger(units) || units < 0) throw new Error(`bad amount: ${usd}`);
  return units;
}

/** Token minor units -> human string like "39.17" (always 2+ decimals, trailing zeros trimmed to 2). */
export function unitsToDisplay(units: number, decimals = 6): string {
  const s = units.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals);
  let frac = s.slice(-decimals).replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${int}.${frac}`;
}

/**
 * Pick a unique payable amount for an invoice: price plus a cents offset in [1, 99]
 * that no other pending invoice on the same chain currently uses.
 * Shared receive addresses cannot tell payers apart, the amount does.
 */
export function allocateAmount(
  priceUnits: number,
  takenAmounts: Set<number>,
  decimals = 6,
  random: () => number = Math.random,
): number {
  const cent = 10 ** (decimals - 2);
  const candidates: number[] = [];
  for (let c = 1; c <= 99; c++) candidates.push(priceUnits + c * cent);
  // Start from a random offset so amounts are not guessable in order.
  const start = Math.floor(random() * candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[(start + i) % candidates.length];
    if (!takenAmounts.has(a)) return a;
  }
  throw new Error("no free amount slot; too many pending invoices for this price");
}

/** Parse a decimal string ("39.17", "39170000" with decimals=0) into integer units without float error. */
export function parseUnits(decimalString: string, decimals = 6): number {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(decimalString.trim());
  if (!m) throw new Error(`bad decimal: ${decimalString}`);
  const int = m[1];
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  const n = Number(int + frac);
  if (!Number.isSafeInteger(n)) throw new Error("amount too large");
  return n;
}

/** Hex (0x...) big number -> integer units. Throws if it does not fit a safe integer. */
export function hexToUnits(hex: string): number {
  const big = BigInt(hex);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("amount too large");
  return Number(big);
}
