export type Role =
  | "support_agent"
  | "finance_approver"
  | "kyc_analyst"
  | "kyc_lead"
  | "auditor";

export interface User {
  id: string;
  name: string;
  roles: Role[];
}

export const USERS: readonly User[] = [
  { id: "u_ana", name: "Ana", roles: ["support_agent"] },
  { id: "u_ben", name: "Ben", roles: ["finance_approver"] },
  { id: "u_rio", name: "Rio", roles: ["support_agent", "finance_approver"] },
  { id: "u_cara", name: "Cara", roles: ["kyc_analyst"] },
  { id: "u_dev", name: "Dev", roles: ["kyc_analyst", "kyc_lead"] },
  { id: "u_lee", name: "Lee", roles: ["kyc_lead"] },
  { id: "u_eve", name: "Eve", roles: ["auditor"] },
];

export function findUser(id: string | undefined | null): User | null {
  if (!id) return null;
  return USERS.find((u) => u.id === id) ?? null;
}
