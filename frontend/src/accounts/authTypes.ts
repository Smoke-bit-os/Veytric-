export type AuthProviderKind = "email" | "guest" | "apple" | "google" | null;

export type Account = {
  id: string;
  name: string;
  email: string;
  provider: AuthProviderKind;
  entitlement?: any;
};

export type AuthResult = {
  success: boolean;
  error?: string;
};
