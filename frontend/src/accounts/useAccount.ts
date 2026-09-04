import { useAuth } from "@/src/auth";

// Provider-agnostic account hook. Wraps the Google-only auth context so screens
// depend on a stable account surface.
export function useAccount() {
  const auth = useAuth();
  return {
    account: auth.user,
    isAuthenticated: !!auth.user,
    provider: auth.provider,
    loading: auth.loading,
    signInWithGoogle: auth.loginWithGoogle,
    signOut: auth.logout,
  };
}
