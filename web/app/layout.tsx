import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "i阅 · 有记忆的 AI 阅读陪伴",
  description: "陪你读书。你读纸质书，i阅 陪着、记着、越来越懂你。",
  icons: {
    icon: [{ url: "/icon", type: "image/png", sizes: "32x32" }],
    shortcut: "/icon",
    apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <Script id="iyue-theme-init" strategy="beforeInteractive">
          {`(function(){try{var t=localStorage.getItem("iyue_theme_v1");document.documentElement.setAttribute("data-theme",t==="day"?"day":"night");}catch(e){document.documentElement.setAttribute("data-theme","night");}})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}
