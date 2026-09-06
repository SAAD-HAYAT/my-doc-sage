/**
 * REST client for the NotesRAG backend.
 * Frontend-only: all calls go to the endpoints the backend will implement.
 */

export type DocumentStatus = "processing" | "ready" | "failed";

export interface RagDocument {
  id: string;
  name: string;
  status: DocumentStatus;
  createdAt: string;
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
    throw new ApiError(res.status, body || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const documentsApi = {
  list: () => apiFetch<RagDocument[]>("/api/documents"),

  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
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
