import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "i阅 Web",
  description: "AI 阅读陪伴 Agent"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
