import type { NextConfig } from 'next';
import type { PluginConfig } from './types.js';
export default function createNextIntlPlugin(i18nPathOrConfig?: string | PluginConfig): (nextConfig?: NextConfig) => NextConfig;
