// lib/admin-infrastructure.ts — server-only MSS admin infrastructure control.
// Wraps the singleton `mainstreet-shield-vm.service` via systemctl.
// Never touches the Next.js app's own service; no arbitrary unit input; no shell strings.
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// The only unit this module may act on — the singleton shield-lab VM service.
// The Next.js app / its own service is deliberately NOT in this list.
export const ALLOWED_UNIT = "mainstreet-shield-vm.service";

const SYSTEMCTL = "/usr/bin/systemctl";

const SHOW_TIMEOUT_MS = 10000;

interface ServiceStateRaw {
  Id?: string;
  ActiveState?: string;
  SubState?: string;
  MemoryCurrent?: string;
}

export interface ServiceState {
  available: boolean;
  unit?: string;
  activeState?: string;
  subState?: string;
  memoryMb?: number | null;
  error?: string;
}

function parseSystemctlShow(output: string): ServiceStateRaw {
  const parsed: ServiceStateRaw = {};
  for (const line of output.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    switch (key) {
      case "Id":
        parsed.Id = value;
        break;
      case "ActiveState":
        parsed.ActiveState = value;
        break;
      case "SubState":
        parsed.SubState = value;
        break;
      case "MemoryCurrent":
        parsed.MemoryCurrent = value;
        break;
    }
  }
  return parsed;
}

export async function getServiceState(): Promise<ServiceState> {
  try {
    const { stdout } = await execFileAsync(
      SYSTEMCTL,
      ["show", ALLOWED_UNIT, "-p", "Id", "-p", "ActiveState", "-p", "SubState", "-p", "MemoryCurrent"],
      { timeout: SHOW_TIMEOUT_MS },
    );
    const parsed = parseSystemctlShow(stdout);

    let memoryMb: number | null = null;
    if (parsed.MemoryCurrent !== undefined && parsed.MemoryCurrent !== "") {
      const bytes = Number(parsed.MemoryCurrent);
      if (!Number.isNaN(bytes)) {
        memoryMb = Math.round(bytes / (1024 * 1024));
      }
    }

    return {
      available: true,
      unit: parsed.Id,
      activeState: parsed.ActiveState,
      subState: parsed.SubState,
      memoryMb,
    };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { available: false, error };
  }
}

export type ServiceAction = "start" | "stop" | "restart";

export async function controlService(
  action: ServiceAction,
): Promise<{ ok: boolean; service?: ServiceState; error?: string }> {
  if (action !== "start" && action !== "stop" && action !== "restart") {
    return { ok: false, error: `invalid action: ${action}` };
  }

  try {
    await execFileAsync(SYSTEMCTL, [action, ALLOWED_UNIT], { timeout: SHOW_TIMEOUT_MS });
    const service = await getServiceState();
    return { ok: true, service };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { ok: false, error };
  }
}
