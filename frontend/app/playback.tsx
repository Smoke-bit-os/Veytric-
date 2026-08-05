import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, LayoutChangeEvent, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import SignalChart from "@/src/vehicle/charts/SignalChart";
import { analysisService } from "@/src/vehicle/performance/analysisService";
import { exportCSV, exportJSON, exportPDF } from "@/src/vehicle/performance/export";
import { colors, font, radius, spacing } from "@/src/theme";

const SIGNALS: { key: string; label: string; unit: string; color: string; decimals?: number }[] = [
  { key: "speed", label: "Speed", unit: "km/h", color: colors.brand },
  { key: "rpm", label: "Engine RPM", unit: "", color: "#7C4DFF" },
  { key: "throttle", label: "Throttle", unit: "%", color: colors.success },
  { key: "coolantTemp", label: "Coolant", unit: "°C", color: colors.warning },
  { key: "batteryVoltage", label: "Battery", unit: "V", color: colors.info, decimals: 1 },
  { key: "boost", label: "Boost/MAP", unit: "kPa", color: "#FF4081" },
];
const SPEEDS = [0.5, 1, 2, 4];
const sevColor = (s: string) => (s === "bad" ? colors.error : s === "warn" ? colors.warning : colors.info);

export default function PlaybackScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [rec, setRec] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [analysis, setAnalysis] = useState<string>("");
  const [analyzing, setAnalyzing] = useState(false);
  const [tlWidth, setTlWidth] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!id) return;
    analysisService.get(id).then((r) => { setRec(r); setAnalysis(r?.ai_analysis || ""); }).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  const samples: any[] = rec?.samples || [];
  const n = samples.length;

  const series = useMemo(() => {
    const out: Record<string, number[]> = {};
    SIGNALS.forEach((s) => { out[s.key] = samples.map((x) => Number(x[s.key] ?? 0)); });
    return out;
  }, [rec]);

  // Playback loop.
  useEffect(() => {
    if (!playing || n < 2) return;
    const perPoint = Math.max(30, ((rec?.duration || n) * 1000 / n) / SPEEDS[speedIdx]);
    const iv = setInterval(() => {
      setCursor((c) => {
        if (c >= n - 1) { setPlaying(false); return c; }
        return c + 1;
      });
    }, perPoint);
    return () => clearInterval(iv);
  }, [playing, speedIdx, n, rec]);

  const idxForT = useCallback((t: number) => {
    if (!n) return 0;
    let best = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs((samples[i].t ?? 0) - t);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }, [samples, n]);

  const seekTimeline = (locX: number) => {
    if (tlWidth <= 0 || n <= 1) return;
    setCursor(Math.max(0, Math.min(n - 1, Math.round((locX / tlWidth) * (n - 1)))));
  };

  const runAnalyze = async () => {
    if (!id) return;
    setAnalyzing(true);
    try {
      const res = await analysisService.analyze(id);
      setAnalysis(res?.analysis || "");
    } catch { Alert.alert("Analysis", "AI analysis is unavailable right now."); }
    setAnalyzing(false);
  };

  const doExport = async (kind: "csv" | "json" | "pdf") => {
    if (!rec) return;
    setExporting(true);
    try {
      const msg = kind === "csv" ? await exportCSV(rec) : kind === "json" ? await exportJSON(rec) : await exportPDF(rec, analysis);
      if (msg) Alert.alert("Export", msg);
    } catch { Alert.alert("Export", "Could not export this session."); }
    setExporting(false);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  if (!rec) return <View style={styles.center}><Text style={styles.dim}>Session not found</Text></View>;

  const cur = samples[Math.min(cursor, n - 1)] || {};
  const curT = cur.t ?? 0;
  const events: any[] = rec.events || [];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="playback-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{rec.name}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
        {/* Summary chips */}
        <View style={styles.summaryRow}>
          <Chip label="Duration" value={`${Math.round(rec.duration || 0)}s`} />
          <Chip label="Distance" value={`${rec.distance ?? 0} km`} />
          <Chip label="Health" value={`${rec.health_score ?? "—"}`} accent />
        </View>

        {/* Timeline scrubber with event bookmarks */}
        <Text style={styles.sectionTitle}>TIMELINE · {(curT / 1000).toFixed(1)}s</Text>
        <View
          testID="timeline"
          style={styles.timeline}
          onLayout={(e: LayoutChangeEvent) => setTlWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(e) => seekTimeline(e.nativeEvent.locationX)}
          onResponderMove={(e) => seekTimeline(e.nativeEvent.locationX)}
        >
          <View style={[styles.tlFill, { width: n > 1 ? `${(cursor / (n - 1)) * 100}%` : "0%" }]} />
          {events.map((ev, i) => {
            const evIdx = idxForT(ev.t);
            const left = n > 1 ? (evIdx / (n - 1)) * tlWidth : 0;
            return <View key={i} style={[styles.tlMark, { left: left - 4, backgroundColor: sevColor(ev.severity) }]} />;
          })}
          <View style={[styles.tlCursor, { left: (n > 1 ? (cursor / (n - 1)) * tlWidth : 0) - 1 }]} />
        </View>

        {/* Playback controls */}
        <View style={styles.controls}>
          <Pressable testID="pb-restart" style={styles.ctrlIcon} onPress={() => { setCursor(0); setPlaying(false); }}>
            <MaterialCommunityIcons name="skip-backward" size={22} color={colors.onSurface} />
          </Pressable>
          <Pressable testID="pb-playpause" style={styles.playBtn} onPress={() => setPlaying((p) => !p)}>
            <MaterialCommunityIcons name={playing ? "pause" : "play"} size={30} color={colors.onBrandPrimary} />
          </Pressable>
          <Pressable testID="pb-speed" style={styles.speedBtn} onPress={() => setSpeedIdx((s) => (s + 1) % SPEEDS.length)}>
            <Text style={styles.speedText}>{SPEEDS[speedIdx]}x</Text>
          </Pressable>
        </View>

        {/* Synchronized graphs */}
        <Text style={styles.sectionTitle}>SYNCHRONIZED SIGNALS</Text>
        {SIGNALS.map((s) => (
          <SignalChart
            key={s.key}
            label={s.label}
            unit={s.unit}
            color={s.color}
            values={series[s.key] || []}
            cursorIndex={cursor}
            onSeek={setCursor}
            decimals={s.decimals || 0}
          />
        ))}

        {/* Event bookmarks */}
        <Text style={styles.sectionTitle}>EVENT BOOKMARKS ({events.length})</Text>
        {events.length === 0 ? (
          <Text style={styles.dim}>No driving events detected in this session.</Text>
        ) : (
          events.map((ev, i) => (
            <Pressable key={i} testID={`bookmark-${i}`} style={styles.bookmark} onPress={() => { setPlaying(false); setCursor(idxForT(ev.t)); }}>
              <View style={[styles.evDot, { backgroundColor: sevColor(ev.severity) }]} />
              <Text style={styles.bmLabel}>{ev.label}</Text>
              <Text style={styles.bmTime}>{(ev.t / 1000).toFixed(1)}s</Text>
              <MaterialCommunityIcons name="crosshairs-gps" size={16} color={colors.onSurfaceSecondary} />
            </Pressable>
          ))
        )}

        {/* AI anomaly analysis */}
        <Text style={styles.sectionTitle}>AI ANOMALY ANALYSIS</Text>
        {analysis ? (
          <View style={styles.aiCard} testID="ai-analysis">
            {analysis.split(/\n+/).filter(Boolean).map((line, i) => {
              const m = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/) || line.match(/^(.+?):\s+(.*)$/);
              if (m) return <Text key={i} style={styles.aiLine}><Text style={styles.aiLabel}>{m[1]}: </Text>{m[2]}</Text>;
              return <Text key={i} style={styles.aiLine}>{line.replace(/\*\*/g, "")}</Text>;
            })}
          </View>
        ) : (
          <Pressable testID="btn-analyze" style={styles.analyzeBtn} onPress={runAnalyze} disabled={analyzing}>
            {analyzing ? <ActivityIndicator color={colors.brand} /> : (
              <><MaterialCommunityIcons name="robot" size={18} color={colors.brand} /><Text style={styles.analyzeText}>Run AI Analysis</Text></>
            )}
          </Pressable>
        )}

        {/* Export */}
        <Text style={styles.sectionTitle}>EXPORT SESSION</Text>
        <View style={styles.exportRow}>
          <ExportBtn testID="export-csv" icon="file-delimited" label="CSV" onPress={() => doExport("csv")} disabled={exporting} />
          <ExportBtn testID="export-json" icon="code-json" label="JSON" onPress={() => doExport("json")} disabled={exporting} />
          <ExportBtn testID="export-pdf" icon="file-pdf-box" label="PDF" onPress={() => doExport("pdf")} disabled={exporting} />
        </View>
      </ScrollView>
    </View>
  );
}

function Chip({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label.toUpperCase()}</Text>
      <Text style={[styles.chipVal, accent && { color: colors.brand }]}>{value}</Text>
    </View>
  );
}
function ExportBtn({ testID, icon, label, onPress, disabled }: any) {
  return (
    <Pressable testID={testID} style={styles.exportBtn} onPress={onPress} disabled={disabled}>
      <MaterialCommunityIcons name={icon} size={22} color={colors.brand} />
      <Text style={styles.exportText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  dim: { color: colors.onSurfaceSecondary, fontSize: 13 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, letterSpacing: 1, flex: 1, textAlign: "center", marginHorizontal: spacing.sm },
  summaryRow: { flexDirection: "row", gap: spacing.sm },
  chip: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: "center" },
  chipLabel: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 1 },
  chipVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 20, marginTop: 2 },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.sm },
  timeline: { height: 40, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: "center", overflow: "hidden" },
  tlFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: colors.brandTertiary },
  tlMark: { position: "absolute", top: 6, width: 8, height: 8, borderRadius: 4 },
  tlCursor: { position: "absolute", top: 0, bottom: 0, width: 2, backgroundColor: colors.brand },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xl, marginTop: spacing.md },
  ctrlIcon: { padding: spacing.md },
  playBtn: { width: 62, height: 62, borderRadius: 31, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  speedBtn: { borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8, minWidth: 52, alignItems: "center" },
  speedText: { color: colors.brand, fontFamily: font.display, fontSize: 16 },
  bookmark: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xs },
  evDot: { width: 8, height: 8, borderRadius: 4 },
  bmLabel: { flex: 1, color: colors.onSurface, fontSize: 14 },
  bmTime: { color: colors.onSurfaceSecondary, fontFamily: font.display, fontSize: 14 },
  aiCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  aiLine: { color: colors.onSurfaceTertiary, fontSize: 13, lineHeight: 20, marginBottom: 6 },
  aiLabel: { color: colors.brand, fontWeight: "700" },
  analyzeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: 14, backgroundColor: colors.brandTertiary },
  analyzeText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
  exportRow: { flexDirection: "row", gap: spacing.sm },
  exportBtn: { flex: 1, alignItems: "center", gap: 6, paddingVertical: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  exportText: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },
});
