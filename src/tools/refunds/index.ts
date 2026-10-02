import type { ToolModule } from "@/platform";
import { approvals } from "./actions";
import { manifest } from "./manifest";
import { migrations, seed } from "./migrations";

export const refunds: ToolModule = { manifest, migrations, seed, approvals };
