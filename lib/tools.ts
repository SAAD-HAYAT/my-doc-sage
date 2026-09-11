// Phase 3: tool schemas + executors for chat()'s tools param.
// search_notes lets the model decide when to search the user's uploaded
// notes (instead of always retrieving up front); list_documents lets it
// check what's been uploaded without spending an embedding call at all.

import { retrieve, type RetrievedChunk } from "./retrieval";
import { supabase } from "./supabase";
import type { ToolDefinition } from "./openrouter";

export const searchNotesTool: ToolDefinition = {
  type: "function",
  function: {
    name: "search_notes",
    description:
      "Search the user's uploaded notes for passages relevant to a query. Use this before " +
      "answering any question that depends on the user's own documents.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for in the notes.",
        },
        k: {
          type: "number",
          description: "How many passages to retrieve (default 5).",
        },
      },
      required: ["query"],
    },
  },
};

export const listDocumentsTool: ToolDefinition = {
  type: "function",
  function: {
    name: "list_documents",
    description:
      "List the documents the user has uploaded, with their name and processing status " +
      '("processing" | "ready" | "failed"). Use this for questions about what has been uploaded.',
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export const tools: ToolDefinition[] = [searchNotesTool, listDocumentsTool];

export type DocumentSummary = { name: string; status: string };

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<RetrievedChunk[] | DocumentSummary[]> {
  switch (name) {
    case "search_notes": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        throw new Error('search_notes requires a non-empty "query" argument');
      }
      const k = typeof args.k === "number" ? args.k : undefined;
      return retrieve(query, k);
    }

    case "list_documents": {
      const { data, error } = await supabase.from("documents").select("name, status");
      if (error) {
        throw new Error(`list_documents failed: ${error.message}`);
      }
      return (data ?? []) as DocumentSummary[];
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
