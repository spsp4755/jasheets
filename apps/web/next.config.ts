
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
});

import type { NextConfig } from "next";

// 폐쇄망: 브라우저는 항상 same-origin(/api)으로 호출하고, Next 서버가 내부 API로 프록시한다.
// WebSocket(/socket.io)은 k8s Ingress가 api 서비스로 직접 라우팅한다.
const API_URL = process.env.API_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  // Disable React Strict Mode to prevent double rendering issues
  // that can cause problems with useEffect cleanup and WebSocket connections
  reactStrictMode: false,
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
    ];
  },
};

export default withPWA(nextConfig);
