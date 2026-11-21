/**
 * Single source of truth for the Cline API host (ported from spaceworker).
 * The SDK's production config and Cline docs use the `.bot` host.
 */
export const CLINE_DEFAULT_API_BASE_URL = "https://api.cline.bot";

export function getClineApiBaseUrl(): string {
  const configured = process.env.CLINE_API_BASE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : CLINE_DEFAULT_API_BASE_URL;
  return base.replace(/\/+$/, "");
}
