// ELM327 command engine over a BLE GATT link (react-native-ble-plx Device).
// NATIVE-ONLY: imports `buffer` and expects a live ble-plx Device. It is never
// pulled into the web bundle because only bleProvider.ts (native) imports it —
// on web, Metro resolves bleProvider.web.ts, which does not touch this file.
//
// Responsibilities: GATT I/O + notification buffering, serialized command
// queue, ELM327 init/handshake, protocol auto-detection, request logging,
// voltage read, and supported-PID discovery.

import { ObdLogEntry } from "../types";
import { parseSupportedPids, protocolName } from "./decoders";

const { Buffer } = require("buffer");

const SERVICE_CANDIDATES = [
  { service: "FFF0", notify: "FFF1", write: "FFF2" },
  { service: "FFE0", notify: "FFE1", write: "FFE1" },
  { service: "FFF0", notify: "FFF1", write: "FFF1" },
  {
    service: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E",
    notify: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E",
    write: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E",
  },
];

const MAX_LOG = 200;

export class Elm327Connection {
  private io: { service: string; notify: string; write: string } | null = null;
  private buffer = "";
  private pending: { resolve: (s: string) => void; reject: (e: Error) => void; timer: any } | null = null;
  private monitorSub: any = null;
  private queue: Promise<any> = Promise.resolve();

  voltage = 0;
  protocol = "Unknown";
  supportedPids: Set<string> = new Set();
  lastLatencyMs = 0;
  log: ObdLogEntry[] = [];

  constructor(private device: any) {}

  private pushLog(e: ObdLogEntry) {
    this.log.push(e);
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  async start() {
    this.io = await this.resolveIo();
    this.monitorSub = this.device.monitorCharacteristicForService(
      this.io.service,
      this.io.notify,
      (error: any, char: any) => {
        if (error || !char?.value) return;
        const chunk = Buffer.from(char.value, "base64").toString("utf-8");
        this.buffer += chunk;
        if (this.buffer.includes(">")) {
          const full = this.buffer.replace(">", "").trim();
          this.buffer = "";
          if (this.pending) {
            clearTimeout(this.pending.timer);
            const p = this.pending;
            this.pending = null;
            p.resolve(full);
          }
        }
      }
    );
  }

  private async resolveIo() {
    const services = await this.device.services();
    const upper = services.map((s: any) => s.uuid.toUpperCase());
    for (const cand of SERVICE_CANDIDATES) {
      if (upper.some((u: string) => u.includes(cand.service))) return cand;
    }
    throw new Error("No compatible OBD-II GATT service found on this adapter");
  }

  // Serialized command send so requests never overlap on the single channel.
  send(cmd: string, timeoutMs = 4000): Promise<string> {
    this.queue = this.queue.then(() => this.rawSend(cmd, timeoutMs)).catch((e) => {
      throw e;
    });
    return this.queue;
  }

  private rawSend(cmd: string, timeoutMs: number): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this.io) return reject(new Error("Not started"));
      const started = Date.now();
      this.buffer = "";
      const payload = Buffer.from(`${cmd}\r`).toString("base64");
      this.pushLog({ ts: started, dir: "tx", cmd, data: cmd, ok: true });

      this.pending = {
        resolve: (s: string) => {
          this.lastLatencyMs = Date.now() - started;
          this.pushLog({ ts: Date.now(), dir: "rx", cmd, data: s, latencyMs: this.lastLatencyMs, ok: !/NO DATA|ERROR|UNABLE|\?/.test(s) });
          resolve(s);
        },
        reject: (e: Error) => {
          this.pushLog({ ts: Date.now(), dir: "rx", cmd, data: e.message, ok: false });
          reject(e);
        },
        timer: setTimeout(() => {
          if (this.pending) {
            this.pending.reject(new Error(`Timeout: ${cmd}`));
            this.pending = null;
          }
        }, timeoutMs),
      };

      this.device
        .writeCharacteristicWithoutResponseForService(this.io.service, this.io.write, payload)
        .catch((e: any) => {
          if (this.pending) {
            clearTimeout(this.pending.timer);
            this.pending.reject(e);
            this.pending = null;
          }
        });
    });
  }

  async init() {
    // Reset + configure the ELM327 for compact, parseable output.
    await this.send("ATZ", 6000).catch(() => "");
    await this.send("ATE0"); // echo off
    await this.send("ATL0"); // linefeeds off
    await this.send("ATS0"); // spaces off
    await this.send("ATH1"); // headers on (needed for multi-ECU + VIN framing)
    await this.send("ATSP0"); // auto protocol
    await this.readVoltage();
    await this.detectProtocol();
    await this.discoverSupportedPids();
  }

  async readVoltage() {
    try {
      const r = await this.send("ATRV");
      const v = parseFloat(r.replace(/[^0-9.]/g, ""));
      if (!Number.isNaN(v)) this.voltage = v;
    } catch {}
    return this.voltage;
  }

  async detectProtocol() {
    // Force negotiation, then read the chosen protocol number.
    await this.send("0100", 6000).catch(() => "");
    try {
      const dpn = await this.send("ATDPN");
      this.protocol = protocolName(dpn);
    } catch {
      this.protocol = "Unknown";
    }
    return this.protocol;
  }

  async discoverSupportedPids() {
    for (const base of [0x00, 0x20, 0x40, 0x60]) {
      try {
        const cmd = "01" + base.toString(16).padStart(2, "0").toUpperCase();
        const resp = await this.send(cmd);
        parseSupportedPids(resp, base).forEach((p) => this.supportedPids.add(p));
        // stop early if this range reports the "next range" PID unsupported
      } catch {
        break;
      }
    }
    return this.supportedPids;
  }

  isSupported(pid: string) {
    // If discovery failed entirely, don't block polling — try anyway.
    return this.supportedPids.size === 0 || this.supportedPids.has(pid.toUpperCase());
  }

  async stop() {
    try {
      this.monitorSub?.remove?.();
    } catch {}
    this.monitorSub = null;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }
}
