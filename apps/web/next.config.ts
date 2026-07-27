import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  transpilePackages: ['@ad-wiki/shared-types', '@ad-wiki/api-client'],
  // Zugriff im Dev-Modus von anderen Geräten im lokalen Netz erlauben
  // (z. B. Handy zum Testen der Mobile-Ansicht). Ohne Eintrag blockt Next
  // Cross-Origin-Requests auf /_next/*-Dev-Ressourcen (HMR, Assets).
  allowedDevOrigins: ['192.168.10.134'],
};

export default nextConfig;
