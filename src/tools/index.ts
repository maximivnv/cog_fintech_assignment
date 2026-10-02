import { registerTools, type ToolModule } from "@/platform";
import { kyc } from "./kyc";
import { refunds } from "./refunds";

/** Every tool on the platform. Add new tools here. */
export const tools: readonly ToolModule[] = registerTools([refunds, kyc]);
