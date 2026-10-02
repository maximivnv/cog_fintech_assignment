const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Format integer cents as USD. */
export function formatCents(cents: number): string {
  return usd.format(cents / 100);
}

/** Parse a user-entered dollar amount ("12.34", "$1,200") into integer cents. Returns null if invalid. */
export function parseDollarsToCents(text: string): number | null {
  const cleaned = text.trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** "1990-04-12" -> "****-**-12"; "AB123456" -> "****3456". */
export function mask(value: string, visible = 4): string {
  if (value.length <= visible) return "*".repeat(value.length);
  const head = value.slice(0, -visible).replace(/[A-Za-z0-9]/g, "*");
  return head + value.slice(-visible);
}
