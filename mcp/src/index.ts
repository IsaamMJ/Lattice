#!/usr/bin/env node
/**
 * Lattice MCP — exposes Lattice findings as MCP context.
 *
 * Design: thin wrapper that shells out to the existing `lattice` bash CLI.
 * Behavior stays in sync with the CLI by construction — no YAML logic
 * duplication. All four tools resolve the active project from the
 * environment in this order:
 *
 *   1. process.env.LATTICE_PROJECT_DIR (explicit override)
 *   2. process.env.CLAUDE_PROJECT_DIR  (Claude Code injects this)
 *   3. process.cwd()                   (last resort)
 *
 * The bash CLI is looked up via env LATTICE_BIN, falling back to `lattice`
 * on PATH. The MCP server never auto-closes; close_finding requires explicit
 * `slug` + `reason` arguments — same gate the /close skill enforces.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const VERSION = "1.0.0";

function projectDir(): string {
  const explicit = process.env.LATTICE_PROJECT_DIR;
  if (explicit && existsSync(explicit)) return explicit;
  const claude = process.env.CLAUDE_PROJECT_DIR;
  if (claude && existsSync(claude)) return claude;
  return process.cwd();
}

function latticeBin(): string {
  return process.env.LATTICE_BIN || "lattice";
}

type RunResult = { ok: boolean; stdout: string; stderr: string; code: number };

// #150: On Windows a bare `bash` is unsafe to spawn. C:\Windows\System32 is
// always on PATH and ships its own `bash.exe` — the WSL launcher — which
// shadows Git Bash and cannot execute a `C:/Users/...` Windows path, so the
// lattice script fails to start. Worse, Claude Code spawns MCP servers with a
// PATH that frequently lacks Git's bin dir entirely, so `bash` may not resolve
// at all. Either way the startup probe fails and the server exits before the
// transport connects ("Connection closed"). Resolve Git Bash to an ABSOLUTE
// path instead of trusting PATH lookup. Override with LATTICE_BASH.
function resolveBash(): string {
  if (process.platform !== "win32") return "bash";
  const override = process.env.LATTICE_BASH;
  if (override && existsSync(override)) return override;
  const localApp =
    process.env["LOCALAPPDATA"] || join(homedir(), "AppData", "Local");
  const candidates = [
    join(process.env["ProgramW6432"] || "C:\\Program Files", "Git", "bin", "bash.exe"),
    join(process.env["ProgramFiles"] || "C:\\Program Files", "Git", "bin", "bash.exe"),
    join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Git", "bin", "bash.exe"),
    join(localApp, "Programs", "Git", "bin", "bash.exe"),
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Last resort: bare `bash`. May hit WSL and fail, but on a non-Git Windows
  // box there is nothing better; on Unix this branch is never reached.
  return "bash";
}

// #16: prefer running the bash script directly with shell:false. With no shell,
// nothing parses the argv, so a free-text `--rationale` (or any input) can never
// be interpreted as a shell command — closing the injection vector that
// shell:true opened on Windows. Only the last-resort PATH fallback uses a shell.
function resolveInvocation(args: string[]): { cmd: string; argv: string[]; shell: boolean } {
  const bin = process.env.LATTICE_BIN;
  const scriptCandidates = [bin, join(homedir(), ".claude", "lattice", "scripts", "lattice")]
    .filter((c): c is string => !!c);
  for (const c of scriptCandidates) {
    if (existsSync(c)) return { cmd: resolveBash(), argv: [c, ...args], shell: false };
  }
  // Fallback: bare `lattice` on PATH. Real binary on Unix (shell:false fine);
  // on Windows without a resolvable script the .cmd shim needs a shell.
  return { cmd: bin || "lattice", argv: args, shell: process.platform === "win32" };
}

function runLattice(args: string[], opts: { timeoutMs?: number } = {}): RunResult {
  const cwd = projectDir();
  const { cmd, argv, shell } = resolveInvocation(args);
  const r = spawnSync(cmd, argv, {
    cwd,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 15000,
    shell,
  });
  return {
    ok: r.status === 0 && !r.error,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    code: r.status ?? -1,
  };
}

function asText(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function asError(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

function createServer() {
  const server = new McpServer(
    {
      name: "lattice",
      version: VERSION,
      description:
        "Lattice findings (code-vs-doc drift, scale risks, security exposures) exposed as MCP context. Read .lattice/findings/ for the active project; never fabricate file:line evidence.",
    },
    {
      instructions:
        "Use lattice tools to read audit findings before recommending code changes in projects with a .lattice/ directory. Prefer get_context for session-start summary, list_findings + show_finding for triage, close_finding only with explicit user confirmation.",
    }
  );

  // ---- get_context -------------------------------------------------------
  server.registerTool(
    "get_context",
    {
      title: "Get Lattice Context",
      description:
        "Return the compact summary `lattice context` emits: mode, telemetry status, open findings counts by tier (actionable + acknowledged), and — in substrate/hybrid mode — active decisions (ADRs) + invariants summary. Use this at the start of work in a Lattice-enabled project.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async () => {
      const r = runLattice(["context"]);
      if (!r.ok && !r.stdout) {
        return asError(
          `lattice context failed (exit ${r.code}). cwd=${projectDir()} bin=${latticeBin()}\n${r.stderr}`
        );
      }
      // If .lattice/ is missing, `lattice context` still exits 0 with a
      // friendly message — return it as-is.
      return asText(r.stdout || "(no output)");
    }
  );

  // ---- list_findings -----------------------------------------------------
  server.registerTool(
    "list_findings",
    {
      title: "List Lattice Findings",
      description:
        "List open findings with optional filters. Returns the same table as `lattice list` — slug, tier, dimension, module, title. Use to triage before drilling into a specific finding.",
      inputSchema: {
        tier: z
          .enum([
            // v2.1.2: match scripts/lattice tier vocabulary completely.
            // Missing previously: RISK, WATCH, INTENTIONAL, UNVERIFIABLE.
            "CRITICAL",
            "BLOCKER",
            "HIGH",
            "RISK",
            "MEDIUM",
            "WATCH",
            "LOW",
            "DRIFT",
            "INTENTIONAL",
            "UNVERIFIABLE",
            "OK",
          ])
          .optional()
          .describe("Filter by tier"),
        module: z
          .string()
          .optional()
          .describe("Filter by module name (matches the `module:` field)"),
        dimension: z
          .enum([
            "audit",
            "scale",
            "security",
            "flow",
            "env-contract",
            "coverage",
            "configuration",
            "quality",
            "product",
            "infra",
            // sync with scripts/lattice-regenerate.sh VALID_DIMENSIONS (#102):
            // shipped in the audit skills (v2.3.0) but the MCP enum lagged.
            "abuse",
            "cli-tool",
            "observability",
            "resilience",
          ])
          .optional()
          .describe("Filter by audit dimension"),
        status: z
          // v2.1.2: bash CLI normalizes "partial" -> "in_progress"; expose
          // both so clients can filter either way.
          .enum(["open", "closed", "deferred", "in_progress", "partial"])
          .optional()
          .describe("Filter by lifecycle status (default: open)"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ tier, module, dimension, status }) => {
      const args = ["list"];
      if (tier) args.push("--tier", tier);
      if (module) args.push("--module", module);
      if (dimension) args.push("--dimension", dimension);
      if (status) args.push("--status", status);
      const r = runLattice(args);
      if (!r.ok && !r.stdout) {
        return asError(
          `lattice list failed (exit ${r.code}) cwd=${projectDir()}\n${r.stderr}`
        );
      }
      return asText(r.stdout || "(no matching findings)");
    }
  );

  // ---- show_finding ------------------------------------------------------
  server.registerTool(
    "show_finding",
    {
      title: "Show Finding YAML",
      description:
        "Pretty-print the full YAML for a finding. Accepts a slug, full path, module/rule shorthand, or substring (same id resolution as `lattice show`).",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe(
            "Finding identifier — slug (HIGH-payments-leak), filename, module/rule, or substring."
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
    },
    async ({ id }) => {
      const r = runLattice(["show", id]);
      if (!r.ok && !r.stdout) {
        return asError(
          `lattice show ${id} failed (exit ${r.code}): ${r.stderr || "no match"}`
        );
      }
      return asText(r.stdout);
    }
  );

  // ---- close_finding -----------------------------------------------------
  server.registerTool(
    "close_finding",
    {
      title: "Close Finding",
      description:
        "Mark a finding closed. DESTRUCTIVE — moves YAML from open/ to closed/ and stamps lifecycle metadata. Always reflect the user's explicit confirmation in the conversation before invoking. The `reason` MUST come from the close-reason taxonomy.",
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe("Finding identifier (slug, filename, module/rule, or substring)."),
        reason: z
          .enum(["fixed", "false-positive", "wont-fix", "out-of-scope", "duplicate"])
          .describe(
            "Close reason. `fixed` requires a commit SHA (pass via `commit` or use `pending`)."
          ),
        commit: z
          .string()
          .optional()
          .describe(
            "Short or full commit SHA that fixes the finding. Required when reason=fixed unless `pending` is true."
          ),
        pending: z
          .boolean()
          .optional()
          .describe(
            "Set when reason=fixed but the commit hasn't landed yet — resolves on next post-commit hook run."
          ),
        rationale: z
          .string()
          .optional()
          .describe("One-line rationale for the close (recommended for false-positive/wont-fix)."),
        pr: z.string().optional().describe("PR number if the close is tied to a PR."),
        // v2.2.5 (#96): programmatic confirmation. The destructiveHint
        // annotation is advisory — hosts may surface it or not. This makes
        // confirmation a precondition the LLM has to actively pass through
        // (it must be `true`), giving the user a chance to intervene if
        // their host auto-runs destructive tools.
        confirm: z
          .literal(true)
          .describe(
            "MUST be true. Programmatic confirmation gate — the assistant must explicitly attest the user authorized this close. Hosts that auto-run destructive tools without surfacing the destructiveHint annotation will be blocked here."
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
        idempotentHint: false,
      },
    },
    async ({ id, reason, commit, pending, rationale, pr, confirm }) => {
      if (confirm !== true) {
        return asError(
          "close_finding: refused. Pass confirm: true after explicit user authorization."
        );
      }
      const args = ["close", id, "--reason", reason];
      if (reason === "fixed") {
        if (pending) {
          args.push("--pending");
        } else if (commit) {
          args.push("--commit", commit);
        } else {
          return asError(
            "close_finding: reason=fixed requires `commit` (SHA) or `pending: true`. The user must confirm one before this call."
          );
        }
      } else if (commit) {
        args.push("--commit", commit);
      }
      if (rationale) args.push("--rationale", rationale);
      if (pr) args.push("--pr", pr);

      const r = runLattice(args);
      if (!r.ok) {
        return asError(
          `lattice close failed (exit ${r.code}): ${r.stderr || r.stdout || "unknown error"}`
        );
      }
      return asText(r.stdout || `closed ${id} (${reason})`);
    }
  );

  return server;
}

async function main() {
  // Refuse to run if the bash CLI isn't reachable — fail loud at startup
  // instead of returning errors per-tool-call.
  const probe = runLattice(["version"], { timeoutMs: 5000 });
  if (!probe.ok) {
    console.error(
      `[lattice-mcp] ERROR: probe \`lattice version\` failed (exit ${probe.code}).\n` +
        `  lattice script: ${latticeBin()}\n` +
        `  bash used:      ${resolveBash()}\n` +
        `  On Windows, the server runs the lattice bash script via Git Bash. If\n` +
        `  bash above is "bash" or a System32/WSL path, install Git for Windows or\n` +
        `  set LATTICE_BASH to the full path of Git's bash.exe. Set LATTICE_BIN to\n` +
        `  the full path of the lattice script if that is wrong.\n${probe.stderr}`
    );
    process.exit(1);
  }
  console.error(`[lattice-mcp] v${VERSION} — using ${latticeBin()} from ${projectDir()}`);

  const transport = new StdioServerTransport();
  const server = createServer();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[lattice-mcp] fatal:", err);
  process.exit(1);
});
