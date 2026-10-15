// Phase 3: tool schemas + executors for chat()'s tools param.
// search_notes lets the model decide when to search the user's uploaded
// notes (instead of always retrieving up front); list_documents lets it
// check what's been uploaded without spending an embedding call at all.
// Phase 7: both executors take the authenticated user's id and scope
// their query by it explicitly -- supabaseAdmin bypasses RLS, so this is
// the only thing preventing one user's tool call from reading another's
// documents/chunks.

import { retrieve, type RetrievedChunk } from "./retrieval";
import { supabaseAdmin } from "./supabase";
import type { ToolDefinition } from "./openrouter";
import {
  inspectSpreadsheets,
  querySpreadsheet,
  SpreadsheetQueryInputError,
} from "./spreadsheet-query";

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

export const inspectSpreadsheetTool: ToolDefinition = {
  type: "function",
  function: {
    name: "inspect_spreadsheet",
    description:
      "Inspect uploaded Excel workbook schemas before a structured query. Returns worksheets, " +
      "column names and letters, inferred value types, row counts, and trim status. Use this when " +
      "the workbook or exact columns are unclear.",
    parameters: {
      type: "object",
      properties: {
        documentName: {
          type: "string",
          description: "Optional exact uploaded workbook filename, such as INS.xlsx.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

export const querySpreadsheetTool: ToolDefinition = {
  type: "function",
  function: {
    name: "query_spreadsheet",
    description:
      "Run an exhaustive, deterministic query over every structured row in an uploaded Excel " +
      "workbook. Use this instead of search_notes for totals, counts, averages, minimum/maximum, " +
      "distinct counts, filters, grouped results, and row lookups. Never calculate an exhaustive " +
      "spreadsheet answer from semantic search passages.",
    parameters: {
      type: "object",
      properties: {
        documentName: { type: "string", description: "Exact uploaded .xlsx filename." },
        sheetName: { type: "string", description: "Optional worksheet name." },
        operation: {
          type: "string",
          enum: ["sum", "count", "count_distinct", "average", "minimum", "maximum", "rows"],
        },
        column: {
          type: "string",
          description: "Column to aggregate. Required except for counting rows or returning rows.",
        },
        filters: {
          type: "array",
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              column: {
                type: "string",
                description:
                  'Exact column name, or "*" to test the text filter against every populated cell in a row.',
              },
              operator: {
                type: "string",
                enum: [
                  "contains",
                  "equals",
                  "starts_with",
                  "ends_with",
                  "greater_than",
                  "greater_than_or_equal",
                  "less_than",
                  "less_than_or_equal",
                  "between",
                  "is_blank",
                  "is_not_blank",
                ],
              },
              value: { type: ["string", "number", "boolean"] },
              secondValue: { type: ["string", "number", "boolean"] },
              caseSensitive: { type: "boolean" },
            },
            required: ["column", "operator"],
            additionalProperties: false,
          },
        },
        filterLogic: { type: "string", enum: ["all", "any"] },
        groupBy: { type: "string" },
        columns: { type: "array", maxItems: 20, items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["operation"],
      additionalProperties: false,
    },
  },
};

export const tools: ToolDefinition[] = [
  searchNotesTool,
  listDocumentsTool,
  inspectSpreadsheetTool,
  querySpreadsheetTool,
];

export type DocumentSummary = { name: string; status: string };

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  userId: string,
): Promise<unknown> {
  switch (name) {
    case "search_notes": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        throw new Error('search_notes requires a non-empty "query" argument');
      }
      const k = typeof args.k === "number" ? args.k : undefined;
      return retrieve(query, userId, k);
    }

    case "list_documents": {
      const { data, error } = await supabaseAdmin
        .from("documents")
        .select("name, status")
        .eq("user_id", userId);
      if (error) {
        throw new Error(`list_documents failed: ${error.message}`);
      }
      return (data ?? []) as DocumentSummary[];
    }

    case "inspect_spreadsheet": {
      const documentName =
        typeof args.documentName === "string" ? args.documentName.trim() : undefined;
      if (documentName && documentName.length > 255) {
        throw new Error("inspect_spreadsheet documentName is too long");
      }
      return inspectSpreadsheets(userId, documentName || undefined);
    }

    case "query_spreadsheet":
      try {
        return await querySpreadsheet(userId, args);
      } catch (error) {
        if (error instanceof SpreadsheetQueryInputError) {
          return { ok: false, error: error.message };
        }
        throw error;
      }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
