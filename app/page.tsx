"use client";

import { useCallback, useEffect, useState } from "react";
import { LogOut, PanelLeft, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DocumentSidebar } from "@/components/notes-rag/document-sidebar";
import { ChatPanel } from "@/components/notes-rag/chat-panel";
import { WhatsNewDialog } from "@/components/notes-rag/whats-new-dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  ApiError,
  chatApi,
  documentsApi,
  filesApi,
  spreadsheetApi,
  type ChatMessage,
  type RagDocument,
} from "@/lib/notes-rag-api";
import { FILE_SIZE_TOO_LARGE_MESSAGE, isUploadTooLarge } from "@/lib/document-upload";
import { prepareDocumentUpload } from "@/lib/document-trimming";
import {
  createDownloadableFile,
  fileClarificationFor,
  requestedFileFormat,
  type DownloadableFile,
  type FileClarification,
} from "@/lib/generated-files";
import {
  buildCategorizedWorkbook,
  listWorkbookDepartments,
  loadCategorizationWorkbook,
  type WorkbookCategory,
} from "@/lib/workbook-categorization";

const DEFAULT_CATEGORIES: WorkbookCategory[] = [
  {
    id: "category-1",
    name: "Production",
    description: "Manufacturing, processing, assembly, packaging, operations, and quality control.",
  },
  {
    id: "category-2",
    name: "Maintenance",
    description: "Mechanical, electrical, engineering, workshop, facilities, and utilities.",
  },
  {
    id: "category-3",
    name: "Administration",
    description: "Finance, human resources, IT, legal, management, and administration.",
  },
  {
    id: "category-4",
    name: "Logistics",
    description: "Warehouse, stores, procurement, supply chain, transport, and dispatch.",
  },
];

function newSessionId() {
  return crypto.randomUUID();
}

function customCategories(answer: string): WorkbookCategory[] {
  const names = answer
    .split(/[,;\n]/)
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length !== 4 || new Set(names.map((name) => name.toLowerCase())).size !== 4) {
    throw new Error("Enter exactly four unique category names separated by commas.");
  }
  return names.map((name, index) => ({
    id: `category-${index + 1}`,
    name,
    description: `Departments that belong to ${name}.`,
  }));
}

function startDownload(file: DownloadableFile) {
  const anchor = document.createElement("a");
  anchor.href = file.url;
  anchor.download = file.name;
  anchor.click();
}

export default function Index() {
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState(newSessionId);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clarification, setClarification] = useState<FileClarification | null>(null);
  const [sourceWorkbook, setSourceWorkbook] = useState<File | null>(null);

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
      documentsApi
        .list()
        .then(setDocuments)
        .catch(() => {});
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
        const wasOversized = isUploadTooLarge(file.size);
        try {
          const prepared = await prepareDocumentUpload(file);
          if (prepared.trimmed) {
            const { unit, included, total } = prepared.trimmed;
            const singularUnit = unit === "pages" ? "page" : unit === "lines" ? "line" : "row";
            const trimMessage =
              unit === "rows" && !wasOversized
                ? "Workbook trimmed for safe processing"
                : FILE_SIZE_TOO_LARGE_MESSAGE;
            toast.warning(trimMessage, {
              description: `Trimmed to ${unit} 1–${included} of ${total}. The chatbot has context through ${singularUnit} ${included}.`,
            });
          } else if (prepared.wasOptimized) {
            toast.warning(FILE_SIZE_TOO_LARGE_MESSAGE, {
              description: file.name.toLowerCase().endsWith(".xlsx")
                ? "The Excel workbook was optimized to fit; all populated rows are available to the chatbot."
                : "The PDF was optimized to fit; all pages are available to the chatbot.",
            });
          }

          const doc = await documentsApi.upload(prepared.file, prepared.trimmed);
          setDocuments((prev) => [doc, ...prev]);
          if (file.name.toLocaleLowerCase("en-US").endsWith(".xlsx")) {
            setSourceWorkbook(file);
          }
        } catch (error) {
          if (wasOversized || (error instanceof ApiError && error.status === 413)) {
            toast.error(FILE_SIZE_TOO_LARGE_MESSAGE, {
              description:
                error instanceof Error
                  ? error.message
                  : "The document could not be trimmed below 4 MB.",
            });
          } else {
            toast.error("Upload failed. Please try again.", {
              description: error instanceof ApiError ? error.message : undefined,
            });
          }
        }
      }
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
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, createdAt: new Date().toISOString() },
      ]);
      const fileRequest = fileClarificationFor(text);
      if (fileRequest) {
        setClarification(fileRequest);
        return;
      }

      const explicitFormat = requestedFileFormat(text);
      if (explicitFormat) {
        setSending(true);
        try {
          const generatedFile = await createDownloadableFile(
            await filesApi.generate(
              text,
              "Use the organization and level of detail explicitly stated in the request.",
              explicitFormat,
            ),
          );
          startDownload(generatedFile);
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: `Created ${generatedFile.name}. You can download it again below.`,
              generatedFile,
              createdAt: new Date().toISOString(),
            },
          ]);
        } catch (error) {
          toast.error("Could not generate the requested file.", {
            description: error instanceof Error ? error.message : undefined,
          });
        } finally {
          setSending(false);
        }
        return;
      }

      setSending(true);
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
            content: "Sorry, I couldn't get an answer just now. Please try again.",
            createdAt: new Date().toISOString(),
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [sessionId],
  );

  const createCategorizedDownload = useCallback(
    async (request: FileClarification, answer: string): Promise<DownloadableFile> => {
      if (!sourceWorkbook) {
        throw new Error(
          "Upload the source Excel workbook in this browser session before requesting categorization.",
        );
      }

      const loaded = await loadCategorizationWorkbook(await sourceWorkbook.arrayBuffer());
      const useExistingCategory = answer === request.options[1];
      let departmentHeader: string;
      let categories: WorkbookCategory[];
      let assignments: { department: string; categoryId: string }[];

      if (useExistingCategory) {
        const categoryHeader = loaded.headers.find(
          (header) => header.trim().toLocaleLowerCase("en-US") === "category",
        );
        if (!categoryHeader) throw new Error("No Category column was found in the workbook.");
        const values = listWorkbookDepartments(loaded, categoryHeader);
        if (values.length !== 4) {
          throw new Error(
            `The Category column contains ${values.length} unique values instead of 4.`,
          );
        }
        categories = values.map((name, index) => ({
          id: `category-${index + 1}`,
          name,
          description: name,
        }));
        assignments = values.map((department, index) => ({
          department,
          categoryId: `category-${index + 1}`,
        }));
        departmentHeader = categoryHeader;
      } else {
        categories = answer === request.options[0] ? DEFAULT_CATEGORIES : customCategories(answer);
        departmentHeader =
          loaded.inferredDepartmentHeader ??
          loaded.headers.find((header) => /^(?:name|department|dept|section)$/i.test(header)) ??
          loaded.headers[0];
        const departments = listWorkbookDepartments(loaded, departmentHeader);
        ({ assignments } = await spreadsheetApi.classifyDepartments(departments, categories));
      }

      const result = await buildCategorizedWorkbook(
        loaded,
        departmentHeader,
        categories,
        assignments,
      );
      const base = sourceWorkbook.name.replace(/\.xlsx$/i, "") || "workbook";
      return {
        name: `${base}-categorized.xlsx`,
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        url: URL.createObjectURL(
          new Blob([Uint8Array.from(result.bytes)], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        ),
      };
    },
    [sourceWorkbook],
  );

  const handleClarification = useCallback(
    async (answer: string) => {
      if (!clarification || sending) return;
      setMessages((prev) => [
        ...prev,
        { role: "user", content: answer, createdAt: new Date().toISOString() },
      ]);
      setSending(true);
      try {
        const generatedFile =
          clarification.mode === "categorize-workbook"
            ? await createCategorizedDownload(clarification, answer)
            : await createDownloadableFile(
                await filesApi.generate(clarification.prompt, answer, clarification.format),
              );
        startDownload(generatedFile);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Created ${generatedFile.name}. You can download it again below.`,
            generatedFile,
            createdAt: new Date().toISOString(),
          },
        ]);
        setClarification(null);
      } catch (error) {
        toast.error("Could not generate the requested file.", {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setSending(false);
      }
    },
    [clarification, createCategorizedDownload, sending],
  );

  const handleNewChat = useCallback(() => {
    for (const message of messages) {
      if (message.generatedFile) URL.revokeObjectURL(message.generatedFile.url);
    }
    setMessages([]);
    setClarification(null);
    setSessionId(newSessionId());
  }, [messages]);

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
        <WhatsNewDialog />
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
            clarification={clarification}
            onClarification={handleClarification}
          />
        </main>
      </div>
    </div>
  );
}
