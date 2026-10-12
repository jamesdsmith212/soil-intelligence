import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Soil Intelligence",
  description:
    "A local field-level soil test map with metric targets, timelapse and result histories.",
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
