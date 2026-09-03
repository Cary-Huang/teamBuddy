import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "../src/components/app-shell.js";

import "./globals.css";

export const metadata: Metadata = {
  title: "TeamBuddy",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
