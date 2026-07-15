import type { Metadata, Viewport } from "next";
import "./globals.css";
import PWAHandler from '@/components/PWAHandler';
import GlobalHeader from '@/components/layout/GlobalHeader';

// ponytail: air-gapped 환경 — next/font/google은 빌드 시 외부 다운로드가 필요하므로 시스템 폰트 스택 사용

export const viewport: Viewport = {
  themeColor: "#1a73e8",
};

export const metadata: Metadata = {
  title: "JaSheets - Web Spreadsheet",
  description: "A Google Sheets-like web spreadsheet application with real-time collaboration and AI features",
  manifest: "/manifest.json",
  icons: [
    { rel: 'apple-touch-icon', url: '/icons/icon-192x192.png' },
    { rel: 'icon', url: '/icons/icon-192x192.png' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body>
        <GlobalHeader />
        <PWAHandler />
        {children}
      </body>
    </html>
  );
}
