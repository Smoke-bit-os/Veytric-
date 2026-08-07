import { AuthResult } from "./authTypes";

// Placeholder social auth providers. They conform to a common shape so wiring
// real Apple Sign In (expo-apple-authentication) and Google Sign In later is a
// configuration task, not an architectural rewrite. Native builds required.

export const appleProvider = {
  name: "apple" as const,
  configured: false,
  async signIn(): Promise<AuthResult> {
    return { success: false, error: "Apple Sign In requires a native build and developer credentials." };
  },
};

export const googleProvider = {
  name: "google" as const,
  configured: false,
  async signIn(): Promise<AuthResult> {
    return { success: false, error: "Google Sign In requires a native build and developer credentials." };
  },
};
