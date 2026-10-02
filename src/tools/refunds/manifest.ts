import type { ToolManifest } from "@/platform";

export const manifest = {
  slug: "refunds",
  name: "Refunds",
  permissions: {
    "refunds:view": ["support_agent", "finance_approver", "auditor"],
    "refunds:request": ["support_agent"],
    "refunds:approve": ["finance_approver"],
  },
  thresholds: {
    /** Up to this amount a refund executes immediately. */
    autoApproveCents: 10_000,
    /** Above this amount a refund is refused: escalate to finance. */
    maxCents: 500_000,
  },
} satisfies ToolManifest;

export const TOOL = manifest.slug;
export const AUTO_APPROVE_CENTS = manifest.thresholds.autoApproveCents;
export const MAX_CENTS = manifest.thresholds.maxCents;
