// Session export helpers — CSV / JSON / PDF via expo-file-system + expo-print + expo-sharing.
// Degrades gracefully on web preview (sharing unavailable) without crashing.
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

const CSV_KEYS = [
  "t", "rpm", "speed", "throttle", "engineLoad", "coolantTemp", "oilTemp",
  "batteryVoltage", "chargingVoltage", "boost", "map", "maf",
  "shortFuelTrim", "longFuelTrim", "knockRetard",
];

const safeName = (n: string) => (n || "session").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);

async function shareFile(uri: string, mime: string): Promise<string> {
  if (Platform.OS === "web") return "Export files are available in the mobile app build.";
  const ok = await Sharing.isAvailableAsync().catch(() => false);
  if (!ok) return "Sharing is not available on this device.";
  await Sharing.shareAsync(uri, { mimeType: mime });
  return "";
}

export async function exportCSV(rec: any): Promise<string> {
  if (Platform.OS === "web") return "CSV export is available in the mobile app build.";
  const samples: any[] = rec.samples || [];
  const header = CSV_KEYS.join(",");
  const rows = samples.map((s) => CSV_KEYS.map((k) => {
    const v = s[k];
    return typeof v === "number" ? Math.round(v * 100) / 100 : (v ?? "");
  }).join(","));
  const csv = [header, ...rows].join("\n");
  const uri = `${FileSystem.cacheDirectory}${safeName(rec.name)}.csv`;
  await FileSystem.writeAsStringAsync(uri, csv);
  return shareFile(uri, "text/csv");
}

export async function exportJSON(rec: any): Promise<string> {
  if (Platform.OS === "web") return "JSON export is available in the mobile app build.";
  const uri = `${FileSystem.cacheDirectory}${safeName(rec.name)}.json`;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(rec, null, 2));
  return shareFile(uri, "application/json");
}

function pill(s: any) {
  const sev = s.severity === "bad" ? "#FF3D00" : s.severity === "warn" ? "#FFB300" : "#00B0FF";
  return `<span style="display:inline-block;margin:2px 4px;padding:3px 8px;border-radius:10px;background:${sev}22;color:${sev};font-size:11px;">${s.label}</span>`;
}

export async function exportPDF(rec: any, analysis?: string): Promise<string> {
  const sum = rec.summary || {};
  const events: any[] = rec.events || [];
  const analysisHtml = (analysis || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br/>");
  const html = `
  <html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
  <body style="font-family:-apple-system,Helvetica,Arial;background:#06080D;color:#F0F2F5;padding:28px;">
    <div style="border-bottom:2px solid #00E5FF;padding-bottom:12px;margin-bottom:18px;">
      <div style="color:#00E5FF;letter-spacing:3px;font-size:12px;">JARVIS AI · PERFORMANCE REPORT</div>
      <h1 style="margin:6px 0;font-size:26px;">${rec.name || "Drive Session"}</h1>
      <div style="color:#9AA0B1;font-size:13px;">${rec.created_at ? new Date(rec.created_at).toLocaleString() : ""} · ${rec.vin || ""}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <tr>
        <td style="padding:8px;background:#111520;border-radius:6px;"><div style="color:#9AA0B1;font-size:10px;">DURATION</div><div style="font-size:20px;color:#00E5FF;">${Math.round(rec.duration || 0)}s</div></td>
        <td style="padding:8px;background:#111520;"><div style="color:#9AA0B1;font-size:10px;">DISTANCE</div><div style="font-size:20px;color:#00E5FF;">${rec.distance ?? 0} km</div></td>
        <td style="padding:8px;background:#111520;"><div style="color:#9AA0B1;font-size:10px;">HEALTH</div><div style="font-size:20px;color:#00E5FF;">${rec.health_score ?? "—"}</div></td>
      </tr>
      <tr>
        <td style="padding:8px;"><div style="color:#9AA0B1;font-size:10px;">MAX SPEED</div><div style="font-size:18px;">${sum.maxSpeed ?? 0} km/h</div></td>
        <td style="padding:8px;"><div style="color:#9AA0B1;font-size:10px;">PEAK RPM</div><div style="font-size:18px;">${sum.peakRpm ?? 0}</div></td>
        <td style="padding:8px;"><div style="color:#9AA0B1;font-size:10px;">LOWEST VOLTAGE</div><div style="font-size:18px;">${sum.lowestVoltage ?? 0} V</div></td>
      </tr>
    </table>
    <h3 style="color:#00E5FF;font-size:13px;letter-spacing:1px;">DETECTED EVENTS (${events.length})</h3>
    <div>${events.map(pill).join("") || '<span style="color:#9AA0B1;">None</span>'}</div>
    ${analysis ? `<h3 style="color:#00E5FF;font-size:13px;letter-spacing:1px;margin-top:20px;">AI ANALYSIS</h3><div style="color:#C3C8D6;font-size:13px;line-height:1.6;">${analysisHtml}</div>` : ""}
  </body></html>`;
  const { uri } = await Print.printToFileAsync({ html });
  if (Platform.OS === "web") return "PDF generated (open the mobile app to share).";
  return shareFile(uri, "application/pdf");
}
