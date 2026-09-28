/**
 * REST client for the NotesRAG backend.
 * Frontend-only: all calls go to the endpoints the backend will implement.
 */

import type { TrimmedRange } from "@/lib/document-upload";

export type DocumentStatus = "processing" | "ready" | "failed";

export interface RagDocument {
  id: string;
  name: string;
  status: DocumentStatus;
  createdAt: string;
  trimmed: TrimmedRange | null;
}

export interface ChatSource {
  documentName: string;
  chunkText: string;
  score: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  createdAt: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let message = body || `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        message = parsed.error;
      }
    } catch {
      // Non-JSON error responses keep their original response text.
    }
    throw new ApiError(res.status, message);
  }
  // 204 No Content (e.g. DELETE) has an empty body — don't try to parse it.
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const documentsApi = {
  list: () => apiFetch<RagDocument[]>("/api/documents"),

  upload: (file: File, trimmed: TrimmedRange | null = null) => {
    const form = new FormData();
    form.append("file", file);
    if (trimmed) {
      form.append("trimmedUnit", trimmed.unit);
      form.append("includedCount", String(trimmed.included));
      form.append("sourceCount", String(trimmed.total));
    }
    return apiFetch<RagDocument>("/api/documents", {
      method: "POST",
      body: form,
    });
  },

  remove: (id: string) =>
    apiFetch<void>(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};

export const chatApi = {
  send: (message: string, sessionId: string) =>
    apiFetch<{ answer: string; sources: ChatSource[] }>("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, sessionId }),
    }),

  history: (sessionId: string) =>
    apiFetch<ChatMessage[]>(`/api/chat/${encodeURIComponent(sessionId)}`),
};
