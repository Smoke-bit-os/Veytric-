import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { storage } from "@/src/utils/storage";
import { api, TOKEN_KEY } from "@/src/api";
import { cacheClear } from "@/src/vehicle/intelligence/cache";
import { licenseCache } from "@/src/licensing/licenseCache";
import { startGoogleLogin, readWebCallback, cleanWebUrl, extractSessionId } from "@/src/googleAuth";

type User = { id: string; name: string; email: string; entitlement?: any };
type AuthProviderKind = "email" | "guest" | "apple" | "google" | null;

const GUEST_KEY = "jarvis_guest";
const UID_KEY = "jarvis_current_uid"; // read by user-scoped caches (e.g. VIN decode)
const GUEST_USER: User = { id: "guest", name: "Guest", email: "" };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  provider: AuthProviderKind;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  loginWithGoogle: () => Promise<boolean>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [provider, setProvider] = useState<AuthProviderKind>(null);
  const [loading, setLoading] = useState(true);
  const usedSessionIds = useRef<Set<string>>(new Set());

  // Persist a Google session_token (same storage slot the API client reads) so
  // every existing authed endpoint keeps working via the Bearer header.
  const persistGoogle = async (res: any) => {
    await clearLocalUserData();
    await storage.secureSet(TOKEN_KEY, res.session_token);
    await storage.removeItem(GUEST_KEY);
    await storage.setItem(UID_KEY, res.user.id);
    setUser(res.user);
    setProvider("google");
  };

  const exchangeSession = async (sessionId: string) => {
    if (!sessionId || usedSessionIds.current.has(sessionId)) return;
    usedSessionIds.current.add(sessionId); // guard: same id can surface twice
    const res = await api.authSession(sessionId);
    await persistGoogle(res);
  };

  useEffect(() => {
    (async () => {
      // 1) OAuth callback takes priority (Critical Rule 3). Web: URL on mount.
      try {
        const webSid = readWebCallback();
        if (webSid) {
          await exchangeSession(webSid);
          cleanWebUrl();
          setLoading(false);
          return;
        }
        // Mobile cold start: app opened via deep link carrying session_id.
        if (Platform.OS !== "web") {
          const initial = await Linking.getInitialURL();
          const sid = extractSessionId(initial);
          if (sid) {
            await exchangeSession(sid);
            setLoading(false);
            return;
          }
        }
      } catch {
        // fall through to normal session/guest restore
      }

      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (token) {
        try {
          const me = await api.me();
          setUser(me);
          setProvider("email");
          await storage.setItem(UID_KEY, me.id);
          setLoading(false);
          return;
        } catch {
          await storage.secureRemove(TOKEN_KEY);
        }
      }
      // No valid session — restore guest mode if it was active.
      const guest = await storage.getItem<boolean>(GUEST_KEY, false);
      if (guest) {
        setUser(GUEST_USER);
        setProvider("guest");
        await storage.setItem(UID_KEY, "guest");
      }
      setLoading(false);
    })();

    // Mobile hot deep links (app already open) also carry session_id.
    const sub = Platform.OS !== "web"
      ? Linking.addEventListener("url", (e) => {
          const sid = extractSessionId(e.url);
          if (sid) exchangeSession(sid).catch(() => {});
        })
      : null;
    return () => sub?.remove();
  }, []);

  // Wipe every device-local, user-scoped cache so no data leaks across
  // accounts or into Guest mode on the same device.
  const clearLocalUserData = async () => {
    await cacheClear();                 // predictions/trends/etc. (veh_intel:)
    await licenseCache.clear().catch(() => {});
    await storage.clearNamespace("veh:");        // any vehicle-scoped local state
    await storage.clearNamespace("scan:");       // cached scan state
    await storage.clearNamespace("vin_decode:"); // user-scoped VIN/VPIC decode cache
  };

  const persist = async (res: any) => {
    // New session → clear anything the previous user/guest left behind first.
    await clearLocalUserData();
    await storage.secureSet(TOKEN_KEY, res.token);
    await storage.removeItem(GUEST_KEY);
    await storage.setItem(UID_KEY, res.user.id);
    setUser(res.user);
    setProvider("email");
  };

  const login = async (email: string, password: string) => {
    const res = await api.login(email, password);
    await persist(res);
  };

  const register = async (name: string, email: string, password: string) => {
    const res = await api.register(name, email, password);
    await persist(res);
  };

  const loginAsGuest = async () => {
    // Guest starts from a clean slate — never inherits a prior user's cache.
    await clearLocalUserData();
    await storage.setItem(GUEST_KEY, true);
    await storage.setItem(UID_KEY, "guest");
    setUser(GUEST_USER);
    setProvider("guest");
  };

  const loginWithGoogle = async (): Promise<boolean> => {
    // Web navigates away and returns via the mount handler; mobile returns the id.
    const sid = await startGoogleLogin();
    if (sid) {
      await exchangeSession(sid);
      return true;
    }
    return false;
  };

  const logout = async () => {
    await storage.secureRemove(TOKEN_KEY);
    await storage.removeItem(GUEST_KEY);
    await storage.removeItem(UID_KEY);
    await clearLocalUserData();
    setUser(null);
    setProvider(null);
  };

  return (
    <Ctx.Provider
      value={{
        user,
        loading,
        isGuest: provider === "guest",
        provider,
        login,
        register,
        loginAsGuest,
        loginWithGoogle,
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
