// VIN extraction from raw on-device OCR text. Pure + offline. NEVER guesses a
// VIN — it only surfaces syntactically valid 17-char candidates for the user to
// confirm. Common OCR confusions (I/O/Q, which are illegal in a real VIN) are
// offered as SEPARATE corrected candidates the user must still approve.

import { isChecksumValid, isValidVinFormat } from "./validator";

export type VinCandidate = {
  vin: string;
  checksumValid: boolean;
  corrected: boolean; // true if we substituted OCR-confused chars (I->1, O->0, Q->0)
};

const VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/;

// Illegal-in-VIN letters that OCR frequently mistakes for digits.
function ocrCorrect(token: string): string {
  return token.replace(/I/g, "1").replace(/O/g, "0").replace(/Q/g, "0");
}

function pushCandidate(
  map: Map<string, VinCandidate>,
  raw: string,
  opts: { requireChecksum?: boolean; allowCorrection?: boolean } = {}
) {
  const token = raw.toUpperCase();
  if (token.length !== 17) return;

  if (VIN_CHARS.test(token)) {
    const checksumValid = isChecksumValid(token);
    if (opts.requireChecksum && !checksumValid) return;
    if (!map.has(token)) map.set(token, { vin: token, checksumValid, corrected: false });
    return;
  }
  // Illegal I/O/Q present. Only offer an OCR-corrected variant for ISOLATED
  // tokens (not sliding-window fragments) to avoid inventing VINs from label text.
  if (opts.allowCorrection && /^[A-Z0-9]{17}$/.test(token) && /[IOQ]/.test(token)) {
    const fixed = ocrCorrect(token);
    if (VIN_CHARS.test(fixed)) {
      const checksumValid = isChecksumValid(fixed);
      if (opts.requireChecksum && !checksumValid) return;
      if (!map.has(fixed)) map.set(fixed, { vin: fixed, checksumValid, corrected: true });
    }
  }
}

/**
 * Find all plausible 17-char VIN candidates in an OCR text blob.
 * Ranked: exact + checksum-valid first, then exact, then corrected.
 */
export function extractVinCandidates(rawText: string): VinCandidate[] {
  const text = (rawText || "").toUpperCase();
  const map = new Map<string, VinCandidate>();

  // 1) whitespace/newline-delimited tokens. A standalone 17-char token is very
  //    likely the VIN — accept format-valid and allow OCR I/O/Q correction.
  for (const chunk of text.split(/\s+/)) {
    pushCandidate(map, chunk.replace(/[^A-Z0-9]/g, ""), { allowCorrection: true });
  }

  // 2) sliding window over the alphanumeric-only stream (handles VINs printed
  //    with internal spaces). EXACT charset + CHECKSUM-VALID only, NO correction,
  //    so we never fabricate a VIN out of surrounding label text.
  const compact = text.replace(/[^A-Z0-9]/g, "");
  for (let i = 0; i + 17 <= compact.length; i++) {
    pushCandidate(map, compact.slice(i, i + 17), { requireChecksum: true });
  }

  return Array.from(map.values()).sort((a, b) => {
    const score = (c: VinCandidate) => (c.checksumValid ? 0 : 1) + (c.corrected ? 2 : 0);
    return score(a) - score(b);
  });
}

export { isValidVinFormat };
