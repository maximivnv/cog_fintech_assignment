/**
 * Platform-wide rules every tool must follow (AGENTS.md "Rules"). The tests discover tools and
 * actions through the registries and the filesystem, so a new tool is covered the day it lands.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import "@/tools";
import {
  PermissionDeniedError,
  actionRegistry,
  closeDb,
  getDb,
  listAudit,
  rolesFor,
  toolRegistry,
  writeAudit,
  type User,
} from "@/platform";

const ROOT = resolve(__dirname, "..");
const TOOLS_DIR = join(ROOT, "src/tools");
const TOOL_PAGES_DIR = join(ROOT, "src/app/tools");

const nobody: User = { id: "u_nobody", name: "Nobody", roles: [] };

function toolSlugs(): string[] {
  if (!existsSync(TOOLS_DIR)) return [];
  return readdirSync(TOOLS_DIR).filter((name) => statSync(join(TOOLS_DIR, name)).isDirectory());
}

/** Actions are defined at import time, so load every tool's actions module before enumerating. */
async function loadAllActions(): Promise<void> {
  for (const slug of toolSlugs()) {
    const file = join(TOOLS_DIR, slug, "actions.ts");
    if (existsSync(file)) await import(file);
  }
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mts|js|jsx|mjs)$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** Module specifiers from `import ... from "x"`, `import "x"`, `export ... from "x"`, `import("x")` and `require("x")`. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) specifiers.push(match[1]);
  }
  return specifiers;
}

/** Which tool a specifier points at, or null if it is not a tool import. */
function importedTool(fromFile: string, specifier: string): string | null {
  const direct = /^@\/tools\/([^/]+)/.exec(specifier);
  if (direct) return direct[1];
  if (specifier.startsWith(".")) {
    const target = resolve(fromFile, "..", specifier);
    const rel = relative(TOOLS_DIR, target);
    if (!rel.startsWith("..")) return rel.split(/[\\/]/)[0] || null;
  }
  return null;
}

beforeEach(() => {
  closeDb();
});

describe("tool registry", () => {
  it("every tool folder is registered, and every registered tool has a folder", () => {
    const registered = toolRegistry.map((t) => t.manifest.slug).sort();
    const folders = toolSlugs().sort();
    expect(registered).toEqual(folders);
  });

  it("every approval kind's permission is in some manifest", () => {
    for (const tool of toolRegistry) {
      for (const [kind, def] of Object.entries(tool.approvals ?? {})) {
        expect(rolesFor(def.permission), `${tool.manifest.slug}.${kind} -> ${def.permission}`).not.toHaveLength(0);
      }
    }
  });
});

describe("actions", () => {
  it("every action refuses a user with no roles and writes a denied audit row", async () => {
    await loadAllActions();
    const actions = [...actionRegistry];

    for (const action of actions) {
      const label = `${action.tool}.${action.name}`;
      closeDb();
      await expect(action(nobody, {}), label).rejects.toBeInstanceOf(PermissionDeniedError);

      const rows = listAudit({ tool: action.tool });
      expect(rows, `${label}: audit rows`).toHaveLength(1);
      expect(rows[0], label).toMatchObject({
        actor_id: nobody.id,
        tool: action.tool,
        action: action.name,
        outcome: "denied",
      });
    }
  });

  it("every action's permission is granted to at least one role in a manifest", async () => {
    await loadAllActions();
    for (const action of actionRegistry) {
      expect(rolesFor(action.permission), `${action.tool}.${action.name} -> ${action.permission}`).not.toHaveLength(0);
    }
  });

  it("every registered tool defines at least one action", async () => {
    await loadAllActions();
    for (const tool of toolRegistry) {
      const slug = tool.manifest.slug;
      expect(actionRegistry.some((a) => a.tool === slug), `${slug} has no actions`).toBe(true);
    }
  });
});

describe("audit log", () => {
  it("UPDATE throws and changes nothing", () => {
    const id = writeAudit({ actorId: "u_ana", tool: "guardrails", action: "probe", outcome: "ok" });
    const db = getDb();
    expect(() => db.prepare("UPDATE audit_log SET outcome = 'denied' WHERE id = ?").run(id)).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE audit_log SET detail_json = '{}'").run()).toThrow(/append-only/);
    expect(listAudit({ tool: "guardrails" })[0]).toMatchObject({ id, outcome: "ok" });
  });

  it("DELETE throws and changes nothing", () => {
    const id = writeAudit({ actorId: "u_ana", tool: "guardrails", action: "probe", outcome: "ok" });
    const db = getDb();
    expect(() => db.prepare("DELETE FROM audit_log WHERE id = ?").run(id)).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM audit_log").run()).toThrow(/append-only/);
    expect(listAudit({ tool: "guardrails" })).toHaveLength(1);
  });
});

describe("tool source files", () => {
  const files = [...sourceFiles(TOOLS_DIR), ...sourceFiles(TOOL_PAGES_DIR)].filter(
    (f) => f !== join(TOOLS_DIR, "index.ts"),
  );

  it("never import node:sqlite", () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        if (spec === "node:sqlite" || spec === "sqlite") offenders.push(`${relative(ROOT, file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never import another tool", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const own = relative(file.startsWith(TOOLS_DIR) ? TOOLS_DIR : TOOL_PAGES_DIR, file).split(/[\\/]/)[0];
      for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
        const target = importedTool(file, spec);
        if (target && target !== own) offenders.push(`${relative(ROOT, file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the import scanner catches the patterns it is meant to", () => {
    const sample = `
      import { DatabaseSync } from "node:sqlite";
      import "@/tools/kyc/actions";
      export { x } from '../refunds/queries';
      const m = await import("./local");
      const r = require("node:sqlite");
    `;
    expect(importSpecifiers(sample)).toEqual([
      "node:sqlite",
      "../refunds/queries",
      "@/tools/kyc/actions",
      "./local",
      "node:sqlite",
    ]);
    const file = join(TOOLS_DIR, "disputes", "actions.ts");
    expect(importedTool(file, "../refunds/queries")).toBe("refunds");
    expect(importedTool(file, "@/tools/kyc")).toBe("kyc");
    expect(importedTool(file, "./queries")).toBe("disputes");
    expect(importedTool(file, "@/platform")).toBeNull();
    expect(importedTool(file, "zod")).toBeNull();
  });
});
