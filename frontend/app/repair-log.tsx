import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { maintenanceService } from "@/src/vehicle/maintenance/maintenanceService";
import { colors, font, radius, spacing } from "@/src/theme";

export default function RepairLogScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [recordings, setRecordings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", parts: "", labor: "", mileage: "", cost: "", detail: "" });
  const [linkRec, setLinkRec] = useState<string | null>(null);
  const [linkRep, setLinkRep] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    api.getVehicleProfile(id).then(setProfile).catch(() => {}).finally(() => setLoading(false));
    api.listRecordings(id).then((r) => setRecordings(r || [])).catch(() => {});
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const repairs = [
    ...((profile?.history?.repair || [])),
    ...((profile?.history?.maintenance || [])),
    ...((profile?.history?.parts || [])),
  ].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const reports = profile?.reports || [];

  const reset = () => {
    setForm({ title: "", parts: "", labor: "", mileage: "", cost: "", detail: "" });
    setLinkRec(null); setLinkRep(null);
  };

  const save = async () => {
    if (!id || !form.title) return;
    setSaving(true);
    try {
      await maintenanceService.addRepair(id, {
        title: form.title,
        detail: form.detail,
        parts: form.parts,
        labor: form.labor,
        mileage: form.mileage ? parseInt(form.mileage) : undefined,
        cost: form.cost ? parseFloat(form.cost) : undefined,
        linkedRecordingId: linkRec || undefined,
        linkedReportId: linkRep || undefined,
      });
      setModal(false); reset(); load();
    } catch {}
    setSaving(false);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="repair-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>REPAIR & SERVICE LOG</Text>
        <Pressable testID="add-repair" onPress={() => setModal(true)} hitSlop={12}>
          <MaterialCommunityIcons name="plus-circle" size={24} color={colors.brand} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} showsVerticalScrollIndicator={false}>
          {repairs.length === 0 ? (
            <View style={styles.empty} testID="repair-empty">
              <MaterialCommunityIcons name="car-wrench" size={48} color={colors.onSurfaceSecondary} />
              <Text style={styles.emptyText}>No service records yet.</Text>
              <Pressable testID="empty-add-repair" style={styles.addCta} onPress={() => setModal(true)}>
                <MaterialCommunityIcons name="plus" size={16} color={colors.brand} />
                <Text style={styles.addCtaText}>Log a Repair</Text>
              </Pressable>
            </View>
          ) : (
            repairs.map((r: any) => {
              const meta = r.meta || {};
              return (
                <View key={r.id} style={styles.card} testID={`repair-${r.id}`}>
                  <View style={styles.cardHead}>
                    <MaterialCommunityIcons name={r.kind === "parts" ? "cog" : r.kind === "maintenance" ? "wrench" : "car-wrench"} size={18} color={colors.brand} />
                    <Text style={styles.cardTitle}>{r.title}</Text>
                    <Text style={styles.cardDate}>{new Date(r.ts).toLocaleDateString()}</Text>
                  </View>
                  {r.detail ? <Text style={styles.detail}>{r.detail}</Text> : null}
                  {meta.parts ? <Text style={styles.field}><Text style={styles.fieldLabel}>Parts: </Text>{meta.parts}</Text> : null}
                  {meta.labor ? <Text style={styles.field}><Text style={styles.fieldLabel}>Labor: </Text>{meta.labor}</Text> : null}
                  <View style={styles.badges}>
                    {meta.mileage != null ? <Badge icon="counter" text={`${Number(meta.mileage).toLocaleString()} km`} /> : null}
                    {meta.cost != null ? <Badge icon="cash" text={`$${meta.cost}`} /> : null}
                    {meta.linkedRecordingId ? <Badge icon="chart-line" text="recording" onPress={() => router.push(`/playback?id=${meta.linkedRecordingId}`)} /> : null}
                    {meta.linkedReportId ? <Badge icon="file-chart" text="scan report" /> : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Add repair modal */}
      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModal(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Log Repair / Service</Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
              {[
                { k: "title", p: "Service title (e.g. Front brake pads)" },
                { k: "parts", p: "Parts replaced (optional)" },
                { k: "labor", p: "Labor notes (optional)" },
                { k: "mileage", p: "Mileage at service (km)", num: true },
                { k: "cost", p: "Cost (optional)", num: true },
                { k: "detail", p: "Additional notes (optional)", multi: true },
              ].map((f) => (
                <TextInput
                  key={f.k}
                  testID={`repair-input-${f.k}`}
                  style={[styles.input, f.multi && { height: 74, textAlignVertical: "top" }]}
                  placeholder={f.p}
                  placeholderTextColor={colors.onSurfaceSecondary}
                  value={(form as any)[f.k]}
                  keyboardType={f.num ? "number-pad" : "default"}
                  multiline={!!f.multi}
                  onChangeText={(t) => setForm((s) => ({ ...s, [f.k]: t }))}
                />
              ))}

              {recordings.length > 0 && (
                <>
                  <Text style={styles.linkLabel}>LINK A RECORDING (optional)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.linkRow}>
                    {recordings.slice(0, 8).map((r) => (
                      <Pressable key={r.id} testID={`link-rec-${r.id}`} style={[styles.linkChip, linkRec === r.id && styles.linkChipActive]} onPress={() => setLinkRec(linkRec === r.id ? null : r.id)}>
                        <Text style={[styles.linkChipText, linkRec === r.id && { color: colors.brand }]} numberOfLines={1}>{r.name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              )}
              {reports.length > 0 && (
                <>
                  <Text style={styles.linkLabel}>LINK A SCAN REPORT (optional)</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.linkRow}>
                    {reports.slice(0, 8).map((r: any) => (
                      <Pressable key={r.id} testID={`link-rep-${r.id}`} style={[styles.linkChip, linkRep === r.id && styles.linkChipActive]} onPress={() => setLinkRep(linkRep === r.id ? null : r.id)}>
                        <Text style={[styles.linkChipText, linkRep === r.id && { color: colors.brand }]}>Health {r.health_score ?? "—"} · {new Date(r.created_at).toLocaleDateString()}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              )}

              <Pressable testID="save-repair" style={styles.saveBtn} onPress={save} disabled={saving || !form.title}>
                <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.saveGrad}>
                  {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>SAVE RECORD</Text>}
                </LinearGradient>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function Badge({ icon, text, onPress }: { icon: string; text: string; onPress?: () => void }) {
  const Cmp: any = onPress ? Pressable : View;
  return (
    <Cmp style={styles.badge} onPress={onPress}>
      <MaterialCommunityIcons name={icon as any} size={12} color={onPress ? colors.brand : colors.onSurfaceSecondary} />
      <Text style={[styles.badgeText, onPress && { color: colors.brand }]}>{text}</Text>
    </Cmp>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  empty: { alignItems: "center", paddingVertical: spacing["3xl"], gap: spacing.md },
  emptyText: { color: colors.onSurfaceSecondary },
  addCta: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 10 },
  addCtaText: { color: colors.brand, fontWeight: "700" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { flex: 1, color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  cardDate: { color: colors.onSurfaceSecondary, fontSize: 11 },
  detail: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: spacing.xs },
  field: { color: colors.onSurfaceTertiary, fontSize: 13, marginTop: 4 },
  fieldLabel: { color: colors.onSurfaceSecondary, fontWeight: "700" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: colors.border },
  badgeText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "600" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border, maxHeight: "88%" },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.lg, paddingVertical: 13, marginBottom: spacing.sm, fontSize: 15 },
  linkLabel: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1, fontWeight: "700", marginTop: spacing.sm, marginBottom: spacing.xs },
  linkRow: { gap: spacing.sm, paddingBottom: spacing.sm },
  linkChip: { maxWidth: 180, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface },
  linkChipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  linkChipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  saveBtn: { borderRadius: radius.md, overflow: "hidden", marginTop: spacing.sm },
  saveGrad: { paddingVertical: 16, alignItems: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1.5 },
});
