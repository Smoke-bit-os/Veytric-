// VEYTRIC — cross-platform confirm/alert.
// react-native-web ships Alert.alert as a NO-OP, so confirmation dialogs and
// result messages silently disappear on web. This wrapper uses the browser's
// window.confirm/window.alert on web and native Alert.alert on iOS/Android so
// destructive flows (e.g. Clear Codes) always get an explicit confirmation and
// the user always sees the post-action result.
import { Alert, Platform } from "react-native";

export function confirmDialog(opts: {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
}) {
  if (Platform.OS === "web") {
    const ok = typeof window !== "undefined" && window.confirm(`${opts.title}\n\n${opts.message}`);
    if (ok) opts.onConfirm();
    else opts.onCancel?.();
    return;
  }
  Alert.alert(opts.title, opts.message, [
    { text: opts.cancelText ?? "Cancel", style: "cancel", onPress: opts.onCancel },
    {
      text: opts.confirmText ?? "OK",
      style: opts.destructive ? "destructive" : "default",
      onPress: opts.onConfirm,
    },
  ]);
}

export function alertDialog(title: string, message: string) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
