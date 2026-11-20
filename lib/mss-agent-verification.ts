import { ClineCore, CORE_BUILD_VERSION, getCoreDefaultEnabledToolIds, isCoreBuiltinToolAvailable } from "@cline/sdk";

export interface MssAgentVerificationResult {
  ok: boolean;
  sdkVersion: string;
  tools: string[];
  sshAvailable: boolean;
  error?: string;
}

/**
 * Verify the MSS Agent (`@cline/sdk` / Cline Core) integration.
 *
 * - Confirms `ClineCore` can be instantiated with an API key / client name.
 * - Lists available tools from the Cline core catalog.
 * - Checks whether an SSH/shell tool is available (dry-run, no actual
 *   connection to any VM).
 *
 * Degrades gracefully: if `ClineCore.create` cannot run in this environment
 * (no workspace/model config), `ok` is false and `error` is set rather than
 * throwing, so the caller can still render a useful status.
 */
export async function verifyMssAgent(): Promise<MssAgentVerificationResult> {
  let core: ClineCore | null = null;
  let createError: string | undefined;

  try {
    core = await ClineCore.create({ clientName: "mss-agent" });
  } catch (err) {
    createError = err instanceof Error ? err.message : "ClineCore instantiation failed";
  }

  const tools: string[] = [];
  let sshAvailable = false;
  try {
    const defaultTools: string[] = (getCoreDefaultEnabledToolIds as () => string[])?.() ?? [];
    tools.push(...defaultTools);
    sshAvailable =
      defaultTools.some((t) => /shell|ssh/.test(String(t))) ||
      (isCoreBuiltinToolAvailable as (toolId: string) => boolean)?.("shell") === true;
  } catch {
    // Tool catalog unavailable — leave tools empty.
  }

  return {
    ok: Boolean(core),
    sdkVersion: CORE_BUILD_VERSION ?? "0.2.0",
    tools,
    sshAvailable,
    ...(createError ? { error: createError } : {}),
  };
}
