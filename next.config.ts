import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep `next dev` from appending its agent-rules block to the repo's AGENTS.md.
  agentRules: false,
};

export default nextConfig;
