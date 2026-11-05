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
  }
}
