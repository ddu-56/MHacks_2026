import type { NextConfig } from 'next';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';

// Single .env at the repo root, shared with the orchestrator.
loadEnvConfig(path.resolve(process.cwd(), '../..'));

const nextConfig: NextConfig = {
  transpilePackages: ['@holdless/db', '@holdless/shared'],
  agentRules: false,
};

export default nextConfig;
