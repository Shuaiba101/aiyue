import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "i阅 · 有记忆的 AI 阅读陪伴",
  description: "陪你读书。你读纸质书，i阅 陪着、记着、越来越懂你。"
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
