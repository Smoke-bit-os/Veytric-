import { useAuth } from "@/src/auth";

// Provider-agnostic account hook. Wraps the auth context so screens depend on
// a stable account surface. Adding Apple / Google later means implementing the
// placeholder providers below and exposing them here — no screen changes.

export function useAccount() {
  const auth = useAuth();
  return {
    account: auth.user,
    isAuthenticated: !!auth.user && !auth.isGuest,
    isGuest: auth.isGuest,
    provider: auth.provider,
    loading: auth.loading,
    signInWithEmail: auth.login,
    registerWithEmail: auth.register,
    continueAsGuest: auth.loginAsGuest,
    signOut: auth.logout,
  };
}
