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

  // /r/:code — validate referral code, set sw_ref cookie, redirect to /signup.
  if (path.startsWith("/r/")) {
    const code = path.slice(3); // strip "/r/"
    // Validate against the referral API.
    const res = await fetch(
      `${request.nextUrl.origin}/api/admin/referrals/validate`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) },
    );
    if (res.ok) {
      const data = await res.json();
      if (data.valid) {
        const redirect = NextResponse.redirect(new URL("/signup", request.url));
        redirect.cookies.set("sw_ref", code, { path: "/", maxAge: 60 * 60 * 24 * 30 }); // 30 days
        return redirect;
      }
    }
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Protected routes requiring referral gate.
  const referralGatedPaths = ["/login", "/signup", "/shield", "/dashboard", "/agent", "/company"];
  const isReferralGated = referralGatedPaths.some((p) => path === p || path.startsWith(p + "/"));

  if (isShieldDomain && isReferralGated) {
    if (!swRef) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};