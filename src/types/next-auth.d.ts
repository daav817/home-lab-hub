import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    groups: string[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    groups?: string[];
    // Sent back to Authentik at sign-out so it can end its own session too.
    idToken?: string;
  }
}
