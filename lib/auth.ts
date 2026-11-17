"use server";

import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { db } from "./db";

const SESSION_SECRET = new TextEncoder().encode(
  process.env.SESSION_SECRET || "dev-secret-change-me"
);

export interface Session {
  userId: string;
  email: string;
  role: string;
  tier: string;
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("shield-session")?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, SESSION_SECRET);
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
      tier: payload.tier as string,
    };
  } catch {
    return null;
  }
}

export async function createSession(user: {
  id: string;
  email: string;
  role: string;
  tier: string;
}): Promise<string> {
  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
    tier: user.tier,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(SESSION_SECRET);

  const cookieStore = await cookies();
  cookieStore.set("shield-session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });

  return token;
}

export async function deleteSession() {
  const cookieStore = await cookies();
  cookieStore.delete("shield-session");
}

export async function requireAdmin(session: Session | null) {
  if (!session || session.role !== "admin") {
    throw new Error("admin required");
  }
}