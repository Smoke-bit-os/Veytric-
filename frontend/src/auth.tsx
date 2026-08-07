import React, { createContext, useContext, useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";
import { api, TOKEN_KEY } from "@/src/api";

type User = { id: string; name: string; email: string; entitlement?: any };
type AuthProviderKind = "email" | "guest" | "apple" | "google" | null;

const GUEST_KEY = "jarvis_guest";
const GUEST_USER: User = { id: "guest", name: "Guest", email: "" };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  isGuest: boolean;
  provider: AuthProviderKind;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({} as AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [provider, setProvider] = useState<AuthProviderKind>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await storage.secureGet<string>(TOKEN_KEY, "");
      if (token) {
        try {
          const me = await api.me();
          setUser(me);
          setProvider("email");
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
      }
      setLoading(false);
    })();
  }, []);

  const persist = async (res: any) => {
    await storage.secureSet(TOKEN_KEY, res.token);
    await storage.removeItem(GUEST_KEY);
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
    await storage.setItem(GUEST_KEY, true);
    setUser(GUEST_USER);
    setProvider("guest");
  };

  const logout = async () => {
    await storage.secureRemove(TOKEN_KEY);
    await storage.removeItem(GUEST_KEY);
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
        logout,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
