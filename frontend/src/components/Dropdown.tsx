import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  FlatList,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";

export type DropdownOption = { label: string; value: string };

type Props = {
  /** Options as {label,value} objects or plain strings. */
  options: (DropdownOption | string)[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  searchable?: boolean;
  clearable?: boolean;
  onClear?: () => void;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
  testID?: string;
};

function normalize(options: (DropdownOption | string)[]): DropdownOption[] {
  return options.map((o) => (typeof o === "string" ? { label: o, value: o } : o));
}

/**
 * VEYTRIC shared searchable select. Modal-based so it renders above all
 * other layers on both web preview and native, never clipped by parent overflow.
 * Never fabricates options — an empty list surfaces the empty/error state.
 */
export default function Dropdown({
  options,
  value,
  onChange,
  placeholder = "Select…",
  label,
  searchable = true,
  clearable = false,
  onClear,
  disabled = false,
  loading = false,
  error = null,
  emptyText = "No options available",
  testID,
}: Props) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const items = useMemo(() => normalize(options), [options]);
  const selected = useMemo(() => items.find((o) => o.value === value) || null, [items, value]);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return items;
    const q = query.trim().toLowerCase();
    return items.filter((o) => o.label.toLowerCase().includes(q));
  }, [items, query, searchable]);

  const openMenu = () => {
    if (disabled || loading) return;
    setQuery("");
    setOpen(true);
  };

  const pick = (opt: DropdownOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label || placeholder}
        accessibilityState={{ disabled: disabled || loading, expanded: open }}
        style={[
          styles.control,
          error ? styles.controlError : null,
          (disabled || loading) ? styles.controlDisabled : null,
        ]}
        onPress={openMenu}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.brand} />
        ) : (
          <Text style={[styles.controlText, !selected && styles.placeholder]} numberOfLines={1}>
            {selected ? selected.label : placeholder}
          </Text>
        )}
        <View style={styles.controlIcons}>
          {clearable && selected && !loading ? (
            <Pressable
              testID={testID ? `${testID}-clear` : undefined}
              hitSlop={10}
              onPress={(e) => {
                e.stopPropagation?.();
                onClear ? onClear() : onChange("");
              }}
            >
              <MaterialCommunityIcons name="close-circle" size={18} color={colors.onSurfaceSecondary} />
            </Pressable>
          ) : null}
          <MaterialCommunityIcons name="chevron-down" size={20} color={colors.onSurfaceSecondary} />
        </View>
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} testID={testID ? `${testID}-backdrop` : undefined} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md, maxHeight: "70%" }]}>
          <View style={styles.handle} />
          {label ? <Text style={styles.sheetTitle}>{label}</Text> : null}
          {searchable ? (
            <View style={styles.searchRow}>
              <MaterialCommunityIcons name="magnify" size={18} color={colors.onSurfaceSecondary} />
              <TextInput
                testID={testID ? `${testID}-search` : undefined}
                style={styles.search}
                placeholder="Search…"
                placeholderTextColor={colors.onSurfaceSecondary}
                value={query}
                onChangeText={setQuery}
                autoFocus={Platform.OS === "web"}
                autoCorrect={false}
              />
            </View>
          ) : null}

          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <MaterialCommunityIcons name="information-outline" size={22} color={colors.onSurfaceSecondary} />
              <Text style={styles.emptyText}>{query ? "No matches" : emptyText}</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(o) => o.value}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const active = item.value === value;
                return (
                  <Pressable
                    testID={testID ? `${testID}-opt-${item.value}` : undefined}
                    style={[styles.option, active && styles.optionActive]}
                    onPress={() => pick(item)}
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {active ? <MaterialCommunityIcons name="check" size={18} color={colors.brand} /> : null}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  label: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: 6, letterSpacing: 0.5 },
  control: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  controlError: { borderColor: colors.error },
  controlDisabled: { opacity: 0.5 },
  controlText: { color: colors.onSurface, fontSize: 15, flex: 1 },
  placeholder: { color: colors.onSurfaceSecondary },
  controlIcons: { flexDirection: "row", alignItems: "center", gap: 6 },
  errorText: { color: colors.error, fontSize: 12, marginTop: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 16, letterSpacing: 1, marginBottom: spacing.sm },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  search: { flex: 1, color: colors.onSurface, fontSize: 15, height: 44 },
  empty: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl },
  emptyText: { color: colors.onSurfaceSecondary, fontSize: 13 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  optionActive: { backgroundColor: colors.brandTertiary },
  optionText: { color: colors.onSurface, fontSize: 15, flex: 1 },
  optionTextActive: { color: colors.brand, fontWeight: "700" },
});
