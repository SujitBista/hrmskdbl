import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HRMS · Saptakoshi Development Bank",
  description:
    "Internal HRMS admin for Saptakoshi Development Bank Limited (SKDBL).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
