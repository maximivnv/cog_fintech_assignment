import type { ToolManifest } from "@/platform";

export const manifest = {
  slug: "disputes",
  name: "Disputes",
  permissions: {
    "disputes:view": ["support_agent", "finance_approver", "auditor"],
    "disputes:work": ["support_agent"],
    "disputes:approve_loss": ["finance_approver"],
  },
  thresholds: {
    /** Accepting a loss above this amount needs a finance approver. */
    acceptLossApprovalCents: 50_000,
  },
} satisfies ToolManifest;

export const TOOL = manifest.slug;
export const ACCEPT_LOSS_APPROVAL_CENTS = manifest.thresholds.acceptLossApprovalCents;
