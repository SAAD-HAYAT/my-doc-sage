// Phase 3: define tool schemas + executors here.
// Leave this file empty/unused during Phase 1 and 2.
//
// Expected shape once you start Phase 3:
//
// export const searchNotesTool = {
//   type: "function",
//   function: {
//     name: "search_notes",
//     description: "Search the user's uploaded notes for relevant context",
//     parameters: {
//       type: "object",
//       properties: {
//         query: { type: "string" },
//         k: { type: "number" },
//       },
//       required: ["query"],
//     },
//   },
// };
//
// export async function executeTool(name: string, args: Record<string, unknown>) {
//   if (name === "search_notes") return retrieve(args.query as string, args.k as number);
//   throw new Error(`Unknown tool: ${name}`);
// }
