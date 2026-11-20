import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Middleware for MainStreet Shield standalone domain (mainstreetmint.click).
// Referral-gated model:
//   - / (homepage) is public — no redirect.
//   - /login redirects to / unless sw_ref cookie present.
//   - /signup, /shield, /dashboard, /agent, /company require sw_ref cookie
//     → redirect to / if missing.
//   - /r/:code validates the referral code, sets sw_ref cookie, then
//     redirects to /signup.
export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") || "";
  const isShieldDomain = host.includes("mainstreetmint.click");
  const path = request.nextUrl.pathname;

  const swRef = request.cookies.get("sw_ref");

  // Public homepage — never redirect.
  if (path === "/") return NextResponse.next();

  // /r/:code — let app/r/[code]/route.ts own it (validates ReferralLink +
  // SignupInvite, stamps sw_ref cookie, 302s to /login). Middleware must not
  // intercept it, or personal share links and admin invite links never reach
  // the route handler.
  if (path.startsWith("/r/")) {
    return NextResponse.next();
  }

  // Protected routes requiring referral gate.
  // /login is email-only sign-in — also requires referral cookie.
  const referralGatedPaths = ["/login", "/signup", "/shield", "/dashboard", "/agent", "/company"];
  const isReferralGated = referralGatedPaths.some((p) => path === p || path.startsWith(p + "/"));

  if (isShieldDomain && isReferralGated) {
    // Allow ?ref=CODE on /signup and /login: validate, set cookie, then proceed.
    // /login needs this too — without it a visitor arriving at /login?ref=CODE
    // (no sw_ref yet) is bounced to / before the page gate runs, and even a
    // successful login would then be kicked off /dashboard for the missing
    // cookie (verification finding F3).
    if (path === "/signup" || path === "/login") {
      const ref = request.nextUrl.searchParams.get("ref");
      if (ref && !swRef) {
        let valid = false;
        try {
          const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
          const res = await fetch(
            `${baseUrl}/api/admin/referrals/validate`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: ref }) },
          );
          if (res.ok) {
            const data = await res.json();
            valid = data.valid === true;
          }
        } catch {
          valid = false;
        }
        if (valid) {
          const response = NextResponse.next();
          response.cookies.set("sw_ref", ref, { path: "/", maxAge: 60 * 60 * 24 * 30 }); // 30 days
          return response;
        }
      }
    }
    if (!swRef) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};