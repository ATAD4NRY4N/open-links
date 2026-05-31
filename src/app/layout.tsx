import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Links Evidence Board",
  description: "Open evidence board for linking entities with source-backed claims",
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
