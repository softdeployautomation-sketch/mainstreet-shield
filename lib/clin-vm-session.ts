import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Cline agent → Shield Linux VM session management
// Full VNC + SSH access to the VM, under human tool-approval gate.
// ---------------------------------------------------------------------------

export interface ClineVmSession {
  id: string;
  userId: string;
  vmId: string;
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshKeyPath: string;
  vncPassword?: string;      // random per-session, never logged to stdout
  clineToken: string;        // cline always-access token
  approvedCommands: string[]; // commands the human has approved this session
  createdAt: Date;
  expiresAt: Date;
}

// Destructive commands that require explicit human approval per session
const DESTRUCTIVE_COMMANDS = [
  "rm", "rmdir", "unlink", "shred",
  "reboot", "poweroff", "shutdown", "halt", "init",
  "mkfs", "fdisk", "parted", "dd",
  "> ", ">> ", "2> ", // redirection truncation
  "chmod", "chown", "chgrp",
  "systemctl", "service",
];

function isDestructiveCommand(cmd: string): boolean {
  const base = cmd.trim().split(/\s+/)[0].toLowerCase();
  return DESTRUCTIVE_COMMANDS.some((d) => base === d.toLowerCase());
}

// GET /api/clin/vm/session — create or retrieve a Cline VM session for the user
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const vm = await db.shieldLinuxVM.findFirst({
    where: { userId: session.userId },
    include: { vncAccess: true },
  });

  if (!vm) {
    return NextResponse.json({ error: "no VM found" }, { status: 404 });
  }

  if (vm.state !== "running") {
    return NextResponse.json(
      { error: "VM not running", state: vm.state },
      { status: 409 }
    );
  }

  // Return connection info for Cline agent
  const vncPassword = vm.vncAccess?.password;
  const clineToken = vm.vncAccess?.clineToken;

  return NextResponse.json({
    sessionId: `cline-vm-${vm.id}`,
    vmId: vm.id,
    sshHost: vm.vmIp || "127.0.0.1",
    sshPort: vm.sshPort || 22,
    sshUser: "shield",
    vncPort: vm.vncPort || 5901,
    vncPassword: vncPassword ?? null,
    clineToken: clineToken ?? null,
    state: vm.state,
  });
}

// POST /api/clin/vm/approve — human approves a destructive command for a session
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { sessionId, command } = await req.json();

  if (!sessionId || !command) {
    return NextResponse.json(
      { error: "sessionId and command required" },
      { status: 400 }
    );
  }

  if (!isDestructiveCommand(command)) {
    return NextResponse.json({
      ok: true,
      note: "command not destructive, no approval needed",
    });
  }

  // Record the approval in context doc (CyberLabContextDocStep pattern)
  await db.contextDocStep.create({
    data: {
      userId: session.userId,
      stepType: "CLINE_VM_COMMAND_APPROVAL",
      content: `Cline VM session ${sessionId}: human approved destructive command: ${command}`,
      createdAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true, approved: true, command });
}