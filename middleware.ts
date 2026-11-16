import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware for MainStreet Shield standalone domain (mainstreetmint.click).
// When the Host header matches the Shield domain, redirect / → /shield
// so the lab is the primary entry point. All other paths pass through.
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const isShieldDomain = host.includes("mainstreetmint.click");
  const path = request.nextUrl.pathname;

  if (isShieldDomain && path === "/") {
    return NextResponse.redirect(new URL("/shield", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};