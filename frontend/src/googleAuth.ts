// Emergent-managed Google sign-in helper (isolated per the integration playbook).
// The frontend NEVER contacts Emergent directly — it only obtains the one-time
// `session_id` from the redirect and hands it to our own POST /api/auth/session.
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

const AUTH_BASE = "https://auth.emergentagent.com/";

function redirectUrl(): string {
  if (Platform.OS === "web") return window.location.origin + "/";
  return Linking.createURL(""); // exp://… in Expo Go, myapp://… in a build
}

function authUrl(): string {
  return `${AUTH_BASE}?redirect=${encodeURIComponent(redirectUrl())}`;
}

// session_id arrives in the hash fragment (or query) — match the raw string,
// because Linking.parse().queryParams cannot see the hash.
export function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// WEB: read session_id from the current URL on mount (hash or query).
export function readWebCallback(): string | null {
  if (Platform.OS !== "web") return null;
  return (
    extractSessionId(window.location.hash) ||
    extractSessionId(window.location.search)
  );
}

// WEB: strip only session_id, preserve everything else + history state.
export function cleanWebUrl() {
  if (Platform.OS !== "web") return;
  const clean = (s: string) =>
    s.replace(/([?#&])session_id=[^&#]*/g, "$1").replace(/[?#&]$/, "");
  const url = window.location.pathname + clean(window.location.search) + clean(window.location.hash);
  window.history.replaceState(window.history.state, "", url || "/");
}

/**
 * Start the Google login.
 * - Web: navigates the page to the auth URL (returns null; callback handled on mount).
 * - Mobile: opens the auth session and returns the session_id (or null if cancelled).
 */
export async function startGoogleLogin(): Promise<string | null> {
  if (Platform.OS === "web") {
    window.location.href = authUrl();
    return null;
  }
  const redirect = redirectUrl();
  // Capture the deep link even if Custom Tabs returns dismiss with no URL (Android).
  let linked: string | null = null;
  const sub = Linking.addEventListener("url", (e) => { linked = e.url; });
  try {
    const result = await WebBrowser.openAuthSessionAsync(authUrl(), redirect);
    const fromResult = (result as any)?.url as string | undefined;
    const initial = fromResult ? null : await Linking.getInitialURL();
    return extractSessionId(fromResult) || extractSessionId(linked) || extractSessionId(initial);
  } finally {
    sub.remove();
  }
}
