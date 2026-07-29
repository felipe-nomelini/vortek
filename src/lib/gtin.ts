export function normalizeGtin(value: unknown): string {
  return String(value || "").replace(/[\s-]+/g, "");
}

export function isValidGtin(value: unknown): boolean {
  const gtin = normalizeGtin(value);
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return false;

  const digits = gtin.split("").map(Number);
  const checkDigit = digits.pop();
  const sum = digits
    .reverse()
    .reduce(
      (total, digit, index) =>
        total + digit * (index % 2 === 0 ? 3 : 1),
      0,
    );

  return (10 - (sum % 10)) % 10 === checkDigit;
}
