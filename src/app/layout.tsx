import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Links Investigative Graph",
  description: "Evidence-first investigative graph for source-backed entities, weighted links, disputes, and X.com provenance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
