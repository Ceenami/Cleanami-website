/** Exact decimal hours x integer cents/hour, rounded to the nearest cent,
 * half up. Avoid binary floating-point half-cent errors before ledger writes. */
export function hourlyPayCents(hours: number, rateCents: number): number {
  if (!Number.isFinite(hours) || hours < 0 || !Number.isSafeInteger(rateCents) || rateCents < 0)
    throw new Error("Invalid hourly pay inputs");
  const [mantissa, exponent = "0"] = String(hours).toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent);
  let numerator = BigInt(whole + fraction) * BigInt(rateCents);
  const denominator = BigInt(10) ** BigInt(Math.max(0, scale));
  if (scale < 0) numerator *= BigInt(10) ** BigInt(-scale);
  const cents = Number((BigInt(2) * numerator + denominator) / (BigInt(2) * denominator));
  if (!Number.isSafeInteger(cents)) throw new Error("Unsafe hourly pay amount");
  return cents;
}
