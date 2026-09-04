const CNPJ_PATTERN = /^[A-Z0-9]{12}\d{2}$/;

/** @param {string | null | undefined} value */
function normalizeCnpj(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** @param {string} character */
function characterValue(character) {
  return character.charCodeAt(0) - 48;
}

/** @param {string} base @param {number[]} weights */
function calculateDigit(base, weights) {
  const total = [...base].reduce(
    (sum, character, index) => sum + characterValue(character) * weights[index],
    0,
  );
  const remainder = total % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** @param {string | null | undefined} value */
function isValidCnpj(value) {
  const normalized = normalizeCnpj(value);
  if (!CNPJ_PATTERN.test(normalized)) return false;
  if (/^(.)\1{13}$/.test(normalized)) return false;

  const base = normalized.slice(0, 12);
  const firstDigit = calculateDigit(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calculateDigit(
    `${base}${firstDigit}`,
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );

  return normalized.slice(12) === `${firstDigit}${secondDigit}`;
}

/** @param {string | null | undefined} value */
function formatCnpj(value) {
  const normalized = normalizeCnpj(value).slice(0, 14);
  if (normalized.length !== 14) return normalized;
  return `${normalized.slice(0, 2)}.${normalized.slice(2, 5)}.${normalized.slice(5, 8)}/${normalized.slice(8, 12)}-${normalized.slice(12)}`;
}

module.exports = { formatCnpj, isValidCnpj, normalizeCnpj };
