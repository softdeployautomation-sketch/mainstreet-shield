"use server";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { jwtVerify, SignJWT } from "jose";
import bcrypt from "bcrypt";
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

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Require that the authenticated user has a password set.
 * Returns the user record or throws an appropriate NextResponse error.
 */
export async function requirePasswordUser(session: Session) {
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, password: true, role: true, tier: true },
  });
  if (!user) {
    throw new NextResponse(
      JSON.stringify({ error: "user not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!user.password) {
    throw new NextResponse(
      JSON.stringify({ error: "password not set — please create one in Settings" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  return user;
}

export async function requireAdmin(session: Session | null) {
  if (!session || session.role !== "admin") {
    throw new Error("admin required");
  }
}