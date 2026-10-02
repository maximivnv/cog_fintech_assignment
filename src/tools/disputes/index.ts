import type { ToolModule } from "@/platform";
import { approvals } from "./actions";
import { manifest } from "./manifest";
import { migrations, seed } from "./migrations";

export const disputes: ToolModule = { manifest, migrations, seed, approvals };
