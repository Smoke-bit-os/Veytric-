// VEYTRIC — Raw response capture + redaction (Prompt 1, Phase 1D)
// Controlled, configurable capture for diagnostic verification. Sensitive data
// is redacted before anything is logged/persisted. Production logging uses safe
// retention limits. Replay fixtures must be sanitized and can never activate as
// live native vehicle data.
export interface RawCaptureConfig {
  enabled: boolean;
  maxEntries: number;   // ring-buffer retention limit
  redact: boolean;
}

export const DEFAULT_CAPTURE_CONFIG: RawCaptureConfig = {
  enabled: false,       // OFF by default (opt-in for diagnostics)
  maxEntries: 200,
  redact: true,
};

export interface RawCaptureEntry {
  ts: number;
  dir: "tx" | "rx";
  protocol?: string;
  text: string;         // already redaction-processed when config.redact
}

// Patterns for values that must NEVER appear in logs/fixtures.
const REDACTIONS: { re: RegExp; with: string }[] = [
  // Bearer / session / access tokens
  { re: /(bearer\s+)[A-Za-z0-9._\-]+/gi, with: "$1[REDACTED_TOKEN]" },
  { re: /("?(?:session_token|access_token|token|authorization|api[_-]?key)"?\s*[:=]\s*"?)[A-Za-z0-9._\-]+/gi, with: "$1[REDACTED]" },
  // OpenAI-style keys
  { re: /sk-[A-Za-z0-9]{8,}/g, with: "[REDACTED_KEY]" },
  // Full 17-char VIN
  { re: /\b[A-HJ-NPR-Z0-9]{17}\b/g, with: "[REDACTED_VIN]" },
  // Long digit runs (payment PAN-ish, 13-19 digits)
  { re: /\b\d{13,19}\b/g, with: "[REDACTED_NUM]" },
  // Emails
  { re: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g, with: "[REDACTED_EMAIL]" },
];

/** Redact sensitive substrings from a raw string. Safe for logs + fixtures. */
export function redactRaw(text: string): string {
  let out = text;
  for (const r of REDACTIONS) out = out.replace(r.re, r.with);
  return out;
}

/** Ring buffer with a hard retention limit; redacts on push when configured. */
export class RawCaptureBuffer {
  private entries: RawCaptureEntry[] = [];
  constructor(private config: RawCaptureConfig = DEFAULT_CAPTURE_CONFIG) {}

  push(dir: "tx" | "rx", text: string, protocol?: string): void {
    if (!this.config.enabled) return;
    const safe = this.config.redact ? redactRaw(text) : text;
    this.entries.push({ ts: Date.now(), dir, protocol, text: safe });
    if (this.entries.length > this.config.maxEntries)
      this.entries.splice(0, this.entries.length - this.config.maxEntries);
  }

  dump(): RawCaptureEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

/** Fixtures are sanitized on load and flagged non-production so replay can never
 *  be mistaken for live vehicle data. */
export interface GoldenFixture {
  id: string;
  description: string;
  protocol?: string;
  request: string;
  response: string;
  /** what the decoder is expected to produce, or an explicit failure */
  expect:
    | { kind: "mode01"; pid: string; signalKey: string; value: number }
    | { kind: "mode01_fail"; pid: string; reason: string }
    | { kind: "dtc"; codeType: "current" | "pending" | "permanent"; codes: string[] }
    | { kind: "vin"; vin: string }
    | { kind: "supported_pids"; base: number; includes: string[]; excludes: string[] }
    | { kind: "unsupported"; note: string };
  nonProduction: true;
}
