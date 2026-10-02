import { registerTools, type ToolModule } from "@/platform";
import { disputes } from "./disputes";
import { refunds } from "./refunds";

/** Every tool on the platform. Add new tools here. */
export const tools: readonly ToolModule[] = registerTools([refunds, disputes]);
