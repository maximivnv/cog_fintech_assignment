import type { DatabaseSync } from "node:sqlite";
import type { Role, User } from "./users";
import type { ApprovalKind } from "./approvals";

export type Db = DatabaseSync;

/** `<tool slug>:<verb>`, e.g. `refunds:approve`. */
export type Permission = `${string}:${string}`;

export interface ToolManifest {
  slug: string;
  name: string;
  /** Which roles hold each permission. */
  permissions: Record<Permission, readonly Role[]>;
  /** Integer cents. Tools decide what each threshold means. */
  thresholds?: Record<string, number>;
}

export interface ToolModule {
  manifest: ToolManifest;
  /** SQL statements run once, in order, after the platform's own migrations. */
  migrations: readonly string[];
  /** Runs once after migrations when the tool's tables are empty. */
  seed?: (db: Db) => void;
  /** Approval kinds the tool can request, keyed by `kind`. */
  approvals?: Record<string, ApprovalKind>;
}

export const toolRegistry: ToolModule[] = [];

export function registerTool(tool: ToolModule): ToolModule {
  const existing = toolRegistry.find((t) => t.manifest.slug === tool.manifest.slug);
  if (existing) {
    if (existing !== tool) {
      throw new Error(`Tool "${tool.manifest.slug}" is already registered`);
    }
    return existing;
  }
  toolRegistry.push(tool);
  return tool;
}

export function registerTools(tools: readonly ToolModule[]): readonly ToolModule[] {
  return tools.map(registerTool);
}

export function getTool(slug: string): ToolModule | undefined {
  return toolRegistry.find((t) => t.manifest.slug === slug);
}

export function rolesFor(permission: Permission): readonly Role[] {
  for (const tool of toolRegistry) {
    const roles = tool.manifest.permissions[permission];
    if (roles) return roles;
  }
  return [];
}

export function can(user: User | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  const roles = rolesFor(permission);
  return user.roles.some((r) => roles.includes(r));
}

/** Tools whose nav entry the user should see: any permission in the manifest. */
export function toolsFor(user: User | null | undefined): ToolModule[] {
  if (!user) return [];
  return toolRegistry.filter((t) =>
    (Object.keys(t.manifest.permissions) as Permission[]).some((p) => can(user, p)),
  );
}
