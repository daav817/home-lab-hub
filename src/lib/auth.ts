import type { NextAuthOptions } from "next-auth";
import AuthentikProvider from "next-auth/providers/authentik";

export const authOptions: NextAuthOptions = {
  providers: [
    AuthentikProvider({
      clientId: "home-lab-hub",
      clientSecret: process.env.AUTHENTIK_CLIENT_SECRET ?? "",
      issuer: process.env.AUTHENTIK_ISSUER,
    }),
  ],
  pages: { signIn: "/sign-in" },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  callbacks: {
    jwt({ token, profile }) {
      if (profile) {
        token.groups = (profile as { groups?: string[] }).groups ?? [];
      }
      return token;
    },
    session({ session, token }) {
      session.groups = token.groups ?? [];
      return session;
    },
  },
};
