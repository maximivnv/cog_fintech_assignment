import type { Metadata } from "next";
import "@/tools";
import { Header } from "@/platform";
import "./globals.css";

export const metadata: Metadata = {
  title: "Internal Tools",
  description: "Internal tools for the ops team",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-zinc-50 text-zinc-900">
        <Header />
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 pb-16 pt-10">{children}</main>
      </body>
    </html>
  );
}
