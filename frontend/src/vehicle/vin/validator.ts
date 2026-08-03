// VIN validation (ISO 3779). Pure, offline, web-safe.

const TRANSLIT: Record<string, number> = {
  "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9,
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function isValidVinFormat(vin: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test((vin || "").toUpperCase());
}

export function isChecksumValid(vin: string): boolean {
  vin = (vin || "").toUpperCase();
  if (!isValidVinFormat(vin)) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += (TRANSLIT[vin[i]] ?? 0) * WEIGHTS[i];
  const check = sum % 11;
  const expected = check === 10 ? "X" : String(check);
  return vin[8] === expected;
}
