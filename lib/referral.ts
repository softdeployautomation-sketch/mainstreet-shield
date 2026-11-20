import "server-only";

import { db } from "@/lib/db";

/** Length of the generated short referral code. */
const REFERRAL_CODE_LEN = 8;

const CHARS =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/1/I/L/O to avoid look-alikes

function generateCode(): string {
  let out = "";
  for (let i = 0; i < REFERRAL_CODE_LEN; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return out;
}

/** A referral link together with its owner. */
export type ReferralLinkView = {
  id: string;
  code: string;
  userId: string;
  clicks: number;
  conversions: number;
  isActive: boolean;
  createdAt: string;
};

/** A referred user (someone who signed up through a link). */
export type ReferredUserView = {
  id: string;
  email: string;
  referredBy: string | null;
  createdAt: string;
};

/**
 * Get (creating if necessary) the referral link owned by `userId`.
 * Every user owns exactly one link they can share to invite others.
 */
export async function getUserReferralLink(
  userId: string
): Promise<ReferralLinkView> {
  let link = await db.referralLink.findUnique({
    where: { userId },
    select: {
      id: true,
      code: true,
      userId: true,
      clicks: true,
      conversions: true,
      isActive: true,
      createdAt: true,
    },
  });
  if (link) {
    return mapLink(link);
  }

  // Create a fresh link with a unique short code.
  let code: string;
  let existing: { code: string } | null;
  do {
    code = generateCode();
    existing = await db.referralLink.findUnique({
      where: { code },
      select: { code: true },
    });
  } while (existing);

  link = await db.referralLink.create({
    data: { code, userId },
    select: {
      id: true,
      code: true,
      userId: true,
      clicks: true,
      conversions: true,
      isActive: true,
      createdAt: true,
    },
  });
  return mapLink(link);
}

/** Look up a referral link by its short code. */
export async function getReferralLinkByCode(
  code: string
): Promise<ReferralLinkView | null> {
  const link = await db.referralLink.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      userId: true,
      clicks: true,
      conversions: true,
      isActive: true,
      createdAt: true,
    },
  });
  if (!link) return null;
  return mapLink(link);
}

/** Look up an active, unredeemed, unexpired signup invite by its token/code. */
export async function getInviteByCode(
  code: string
): Promise<{
  id: string;
  token: string;
  email: string | null;
  createdBy: string;
  usedById: string | null;
  expiresAt: Date;
} | null> {
  const invite = await db.signupInvite.findUnique({
    where: { token: code },
    select: { id: true, token: true, email: true, createdBy: true, usedById: true, expiresAt: true },
  });
  if (!invite) return null;
  if (invite.usedById) return null;
  if (new Date(invite.expiresAt) <= new Date()) return null;
  return invite;
}

/** Increment the click counter on a link (called when /r/:code is hit). */
export async function recordReferralClick(code: string): Promise<void> {
  await db.referralLink.update({
    where: { code },
    data: { clicks: { increment: 1 } },
  });
}

/**
 * Validate that a referral code points at an active link.
 * Returns the link view or null.
 */
export async function validateReferral(
  code: string
): Promise<ReferralLinkView | null> {
  const link = await getReferralLinkByCode(code);
  if (!link || !link.isActive) return null;
  return link;
}

/**
 * Attribute `userId` to the referral that brought them in.
 * Sets referredBy (referrer's code) + referredByLinkId (FK), and bumps
 * the link's conversion counter. Idempotent: only writes when the link
 * actually changed; wrapped in a transaction.
 */
export async function attributeReferral({
  userId,
  linkId,
  referrerCode,
  referrerEmail,
}: {
  userId: string;
  linkId: string;
  referrerCode: string;
  referrerEmail: string;
}): Promise<void> {
  const existing = await db.user.findUnique({
    where: { id: userId },
    select: { referredByLinkId: true, referredBy: true },
  });
  if (!existing) return;
  if (existing.referredByLinkId === linkId && existing.referredBy === referrerCode) {
    return; // already attributed
  }

  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { referredBy: referrerCode, referredByLinkId: linkId },
    }),
    db.referralLink.update({
      where: { id: linkId },
      data: { conversions: { increment: 1 } },
    }),
  ]);
}

/** Mark a referral link as claimed (status change for Referral model backward compat). */
export async function claimReferralCode(
  code: string,
  referredId: string
): Promise<void> {
  await db.referral.updateMany({
    where: { code, status: "pending" },
    data: { status: "claimed", referredId },
  });
}

/**
 * Combined ACCESS gate for the /login and /signup pages: a code grants access if
 * it is EITHER a valid active universal referral link OR an active, unredeemed,
 * unexpired SignupInvite OR a Referral with status "pending". Returns a plain
 * boolean — the pages only need "may this visitor proceed?", not the link object.
 * The hard invite email-match is enforced later, in the signup route.
 */
export async function hasAccessGate(code: string): Promise<boolean> {
  const ref = await validateReferral(code);
  if (ref) return true;
  const invite = await getInviteByCode(code);
  if (invite) return true;
  const referral = await db.referral.findUnique({
    where: { code },
    select: { id: true, status: true },
  });
  return !!referral && referral.status === "pending";
}

function mapLink(l: {
  id: string;
  code: string;
  userId: string;
  clicks: number;
  conversions: number;
  isActive: boolean;
  createdAt: Date;
}): ReferralLinkView {
  return {
    id: l.id,
    code: l.code,
    userId: l.userId,
    clicks: l.clicks,
    conversions: l.conversions,
    isActive: l.isActive,
    createdAt: l.createdAt.toISOString(),
  };
}