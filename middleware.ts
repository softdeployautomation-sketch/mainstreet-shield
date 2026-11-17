import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware for MainStreet Shield standalone domain (mainstreetmint.click).
// Homepage (/) is public — no redirect. Auth-gated routes redirect to /signup
// when no session exists. All other paths pass through.
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const isShieldDomain = host.includes("mainstreetmint.click");
  const path = request.nextUrl.pathname;

  // Protect /shield and /dashboard and /agent and /company from unauthenticated access
  const protectedPaths = ["/shield", "/dashboard", "/agent", "/company"];
  const isProtected = protectedPaths.some((p) => path === p || path.startsWith(p + "/"));

  if (isShieldDomain && isProtected) {
    const hasSessionCookie = request.cookies.has("shield-session");
    if (!hasSessionCookie) {
      return NextResponse.redirect(new URL("/signup", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};