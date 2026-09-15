"use client";

import { useCallback, useEffect, useState } from "react";
import { LogOut, PanelLeft, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DocumentSidebar } from "@/components/notes-rag/document-sidebar";
import { ChatPanel } from "@/components/notes-rag/chat-panel";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  chatApi,
  documentsApi,
  type ChatMessage,
  type RagDocument,
} from "@/lib/notes-rag-api";

function newSessionId() {
  return crypto.randomUUID();
}

export default function Index() {
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState(newSessionId);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Initial document load
  useEffect(() => {
    documentsApi
      .list()
      .then(setDocuments)
      .catch(() => toast.error("Couldn't load documents — is the API running?"));
  }, []);

  // Poll for processing documents
  useEffect(() => {
    if (!documents.some((d) => d.status === "processing")) return;
    const t = setInterval(() => {
      documentsApi.list().then(setDocuments).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [documents]);

  // Load history when the session changes
  useEffect(() => {
    chatApi
      .history(sessionId)
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [sessionId]);

  const handleUpload = useCallback(async (files: File[]) => {
    setUploading(true);
    try {
      for (const file of files) {
        const doc = await documentsApi.upload(file);
        setDocuments((prev) => [doc, ...prev]);
      }
    } catch {
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setDeletingId(id);
    try {
      await documentsApi.remove(id);
      setDocuments((prev) => prev.filter((d) => d.id !== id));
    } catch {
      toast.error("Couldn't delete that document.");
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      setSending(true);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, createdAt: new Date().toISOString() },
      ]);
      try {
        const res = await chatApi.send(text, sessionId);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: res.answer,
            sources: res.sources,
            createdAt: new Date().toISOString(),
          },
        ]);
      } catch {
        toast.error("Something went wrong getting an answer.");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Sorry, I couldn't get an answer just now. Please try again.",
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [sessionId],
  );

  const handleNewChat = useCallback(() => {
    setMessages([]);
    setSessionId(newSessionId());
  }, []);

  // Phase 7 (auth): full navigation (not client-side router push) after
  // sign-out, so middleware.ts re-evaluates the now-cleared session on
  // the next request rather than leaving stale client state around.
  const handleLogout = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }, []);

  const hasReadyDocuments = documents.some((d) => d.status === "ready");

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open sidebar"
        >
          <PanelLeft className="size-4" />
        </Button>
        <h1 className="text-sm font-semibold tracking-tight">NotesRAG</h1>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleNewChat}>
          <RotateCcw className="size-3.5" />
          New chat
        </Button>
        <Button variant="ghost" size="sm" onClick={handleLogout} aria-label="Log out">
          <LogOut className="size-3.5" />
          Log out
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <DocumentSidebar
          documents={documents}
          uploading={uploading}
          deletingId={deletingId}
          onUpload={handleUpload}
          onDelete={handleDelete}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <ChatPanel
            messages={messages}
            sending={sending}
            hasDocuments={hasReadyDocuments}
            onSend={handleSend}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        </main>
      </div>
    </div>
  );
}
