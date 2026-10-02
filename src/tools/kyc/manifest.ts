import type { ToolManifest } from "@/platform";

export const manifest = {
  slug: "kyc",
  name: "KYC review",
  permissions: {
    "kyc:view": ["kyc_analyst", "kyc_lead", "auditor"],
    "kyc:decide": ["kyc_analyst", "kyc_lead"],
    "kyc:approve_high_risk": ["kyc_lead"],
    "kyc:reveal_pii": ["kyc_analyst", "kyc_lead"],
  },
  thresholds: {
    /** A risk score at or above this (or any watchlist hit) makes a case high risk. */
    highRiskScore: 70,
    /** How long an audited reveal keeps PII visible to the user who revealed it. */
    revealWindowMinutes: 15,
  },
} satisfies ToolManifest;

export const TOOL = manifest.slug;
export const HIGH_RISK_SCORE = manifest.thresholds.highRiskScore;
export const REVEAL_WINDOW_MS = manifest.thresholds.revealWindowMinutes * 60_000;
