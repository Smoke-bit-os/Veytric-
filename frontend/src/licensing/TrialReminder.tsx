import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { useLicense } from "./LicenseProvider";
import { trialReminderStage } from "./trialEngine";
import { storage } from "@/src/utils/storage";

// Root-mounted, renders nothing. Shows a one-time nudge when the Pro trial
// crosses 7 / 3 / 1 / last-day milestones. Persists shown milestones keyed by
// the current trial's end date so a brand-new trial resets automatically.
const KEY = "jarvis_trial_reminders";

export default function TrialReminder() {
  const router = useRouter();
  const { status, trialDaysRemaining, entitlement, loading } = useLicense();
  const busy = useRef(false);

  useEffect(() => {
    if (loading || status !== "trial" || !entitlement.trialEnd) return;
    const stage = trialReminderStage(trialDaysRemaining);
    if (stage === null || busy.current) return;
    busy.current = true;
    (async () => {
      try {
        const raw = await storage.getItem<string>(KEY, "");
        let shown: Record<string, number[]> = {};
        try { shown = raw ? JSON.parse(raw) : {}; } catch { shown = {}; }
        const trialKey = entitlement.trialEnd as string;
        const seen = shown[trialKey] || [];
        if (seen.includes(stage)) return;
        seen.push(stage);
        // Keep only the current trial's record.
        await storage.setItem(KEY, JSON.stringify({ [trialKey]: seen }));
        const msg =
          stage === 0
            ? "Your VEYTRIC Pro trial ends today. Upgrade now to keep Advanced Scan, AI Health Reports, Predictive Maintenance and more — your data stays safe either way."
            : `Your VEYTRIC Pro trial ends in ${stage} day${stage === 1 ? "" : "s"}. Upgrade to keep full access to your Pro features.`;
        Alert.alert("VEYTRIC Pro Trial", msg, [
          { text: "Later", style: "cancel" },
          { text: "Upgrade", onPress: () => router.push("/upgrade") },
        ]);
      } finally {
        busy.current = false;
      }
    })();
  }, [loading, status, trialDaysRemaining, entitlement.trialEnd, router]);

  return null;
}
