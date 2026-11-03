/** Exact rational arithmetic over validated finite decimal inputs.
 * IEEE floats are used only at the serialization boundary, never for ceilings.
 */
export class Decimal {
  readonly n: bigint;
  readonly d: bigint;
  private constructor(n: bigint, d: bigint) {
    let a = n < 0 ? -n : n,
      b = d;
    while (b !== BigInt(0)) {
      const rest = a % b;
      a = b;
      b = rest;
    }
    this.n = n / a;
    this.d = d / a;
  }
  static of(value: number | Decimal): Decimal {
    if (value instanceof Decimal) return value;
    if (!Number.isFinite(value) || Math.abs(value) > 1e12)
      throw new Error("Unsafe decimal input");
    const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
    const [whole, fraction = ""] = mantissa.split(".");
    const scale = fraction.length - Number(exponent);
    const n = BigInt(whole + fraction);
    return scale >= 0
      ? new Decimal(n, BigInt(10) ** BigInt(scale))
      : new Decimal(n * BigInt(10) ** BigInt(-scale), BigInt(1));
  }
  add(value: number | Decimal) {
    const b = Decimal.of(value);
    return new Decimal(this.n * b.d + b.n * this.d, this.d * b.d);
  }
  sub(value: number | Decimal) {
    const b = Decimal.of(value);
    return new Decimal(this.n * b.d - b.n * this.d, this.d * b.d);
  }
  mul(value: number | Decimal) {
    const b = Decimal.of(value);
    return new Decimal(this.n * b.n, this.d * b.d);
  }
  div(value: number | Decimal) {
    const b = Decimal.of(value);
    if (b.n <= BigInt(0)) throw new Error("Positive divisor required");
    return new Decimal(this.n * b.d, this.d * b.n);
  }
  lte(value: number | Decimal) {
    const b = Decimal.of(value);
    return this.n * b.d <= b.n * this.d;
  }
  max(value: number | Decimal) {
    const b = Decimal.of(value);
    return this.lte(b) ? b : this;
  }
  up(step: number | Decimal) {
    const b = Decimal.of(step);
    const ratio = this.div(b);
    if (ratio.n < BigInt(0)) throw new Error("Nonnegative ceiling required");
    return new Decimal(
      (ratio.n + ratio.d - BigInt(1)) / ratio.d,
      BigInt(1),
    ).mul(b);
  }
  number() {
    let result = Number(this.n) / Number(this.d);
    if (!Number.isFinite(result)) {
      const negative = this.n < BigInt(0),
        n = negative ? -this.n : this.n;
      const exponent = String(n).length - String(this.d).length;
      const scale = 18 - exponent;
      const digits =
        scale >= 0
          ? (n * BigInt(10) ** BigInt(scale)) / this.d
          : n / (this.d * BigInt(10) ** BigInt(-scale));
      result = Number(`${negative ? "-" : ""}${digits}e${exponent - 18}`);
    }
    if (
      !Number.isFinite(result) ||
      Math.abs(result) > Number.MAX_SAFE_INTEGER / 100
    )
      throw new Error("Unsafe arithmetic result");
    return result;
  }
  /** Actual ledger money: nearest cent, half up. Model costs stay unrounded. */
  cents() {
    if (this.n < BigInt(0)) throw new Error("Nonnegative money required");
    const scaled = this.mul(100);
    const result = Number(
      (BigInt(2) * scaled.n + scaled.d) / (BigInt(2) * scaled.d),
    );
    if (!Number.isSafeInteger(result)) throw new Error("Unsafe money result");
    return result;
  }
}
