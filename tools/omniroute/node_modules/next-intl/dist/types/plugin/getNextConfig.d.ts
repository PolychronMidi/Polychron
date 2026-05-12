import type { NextConfig } from 'next';
import type { PluginConfig } from './types.js';
export default function getNextConfig(pluginConfig: PluginConfig, nextConfig?: NextConfig): NextConfig & Partial<NextConfig>;
