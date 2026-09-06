import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "NotesRAG — Chat with your documents",
  description:
    "NotesRAG is a personal RAG chatbot that answers questions using your own uploaded PDF and Markdown documents, with cited sources.",
  icons: { icon: "/favicon.ico" },
  openGraph: {
    title: "NotesRAG — Chat with your documents",
    description:
      "A personal RAG chatbot that answers questions using your own uploaded documents, with cited sources.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
