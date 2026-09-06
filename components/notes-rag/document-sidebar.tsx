"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Trash2, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RagDocument } from "@/lib/notes-rag-api";

const ACCEPTED = ".pdf,.md,.markdown";

const statusStyles: Record<RagDocument["status"], string> = {
  ready: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  processing:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

const statusLabels: Record<RagDocument["status"], string> = {
  ready: "Ready",
  processing: "Processing",
  failed: "Failed",
};

interface DocumentSidebarProps {
  documents: RagDocument[];
  uploading: boolean;
  deletingId: string | null;
  onUpload: (files: File[]) => void;
  onDelete: (id: string) => void;
  open: boolean;
  onClose: () => void;
}

export function DocumentSidebar({
  documents,
  uploading,
  deletingId,
  onUpload,
  onDelete,
  open,
  onClose,
}: DocumentSidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const pickFiles = (list: FileList | null) => {
    if (!list) return;
    const files = Array.from(list).filter((f) =>
      /\.(pdf|md|markdown)$/i.test(f.name),
    );
    if (files.length) onUpload(files);
  };

  return (
    <>
      {/* Mobile scrim */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-foreground/20 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-muted/30 transition-transform duration-200 md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center justify-between px-4 py-3 md:hidden">
          <span className="text-sm font-medium">Documents</span>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close sidebar">
            <X className="size-4" />
          </Button>
        </div>

        {/* Upload drop zone */}
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pickFiles(e.dataTransfer.files);
            }}
            disabled={uploading}
            className={cn(
              "flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background px-4 py-6 text-center transition-colors hover:border-foreground/30 hover:bg-accent/50 disabled:opacity-60",
              dragging && "border-foreground/50 bg-accent",
            )}
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            ) : (
              <Upload className="size-5 text-muted-foreground" />
            )}
            <span className="text-sm font-medium">
              {uploading ? "Uploading…" : "Upload documents"}
            </span>
            <span className="text-xs text-muted-foreground">
              PDF or Markdown · drop files here
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            className="hidden"
            onChange={(e) => {
              pickFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* Document list */}
        <div className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
          {documents.length === 0 ? (
            <p className="px-2 pt-2 text-xs text-muted-foreground">
              No documents yet. Upload your notes to get started.
            </p>
          ) : (
            <ul className="space-y-1">
              {documents.map((doc) => (
                <li
                  key={doc.id}
                  className="group flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-accent/60"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{doc.name}</p>
                    <Badge
                      variant="outline"
                      className={cn("mt-0.5 text-[10px]", statusStyles[doc.status])}
                    >
                      {doc.status === "processing" && (
                        <Loader2 className="size-2.5 animate-spin" />
                      )}
                      {statusLabels[doc.status]}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => onDelete(doc.id)}
                    disabled={deletingId === doc.id}
                    aria-label={`Delete ${doc.name}`}
                  >
                    {deletingId === doc.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}