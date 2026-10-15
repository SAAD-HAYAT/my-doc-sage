export interface FeatureAnnouncement {
  id: string;
  date: string;
  title: string;
  items: string[];
}

export const FEATURE_ANNOUNCEMENTS: FeatureAnnouncement[] = [
  {
    id: "2026-10-15-structured-workbook-exports",
    date: "October 15, 2026",
    title: "Complete Excel exports",
    items: [
      "Generate multi-sheet workbooks from uploaded Excel data directly from chat.",
      "Filtered row exports now include every retained match instead of only search passages.",
      "Combine detailed row sheets with exact totals, counts, averages, minimums, and maximums.",
    ],
  },
  {
    id: "2026-10-15-structured-spreadsheet-queries",
    date: "October 15, 2026",
    title: "Reliable Excel calculations",
    items: [
      "Ask for totals, counts, averages, minimums, maximums, filters, and grouped Excel results.",
      "Calculations now scan every retained workbook row instead of relying on a few search matches.",
      "Answers report matched rows and disclose when a workbook was trimmed or needs re-uploading.",
    ],
  },
  {
    id: "2026-10-13-model-file-clarifications",
    date: "October 13, 2026",
    title: "Smarter file creation",
    items: [
      "File creation now starts immediately when your request already has enough detail.",
      "When a choice is genuinely needed, the question and suggestions are tailored by the model.",
      "Custom clarification prompts now explain the specific detail you can provide.",
    ],
  },
  {
    id: "2026-10-12-workbook-categorization",
    date: "October 12, 2026",
    title: "Generate files from chat",
    items: [
      "Ask NotesRAG to create an Excel, PDF, or Markdown file.",
      "Answer a tailored clarification or enter a custom option when more detail is needed.",
      "Categorize an uploaded workbook into four traceable worksheets without a separate toolbar action.",
    ],
  },
  {
    id: "2026-10-02-excel-support",
    date: "October 2, 2026",
    title: "Excel files are now supported",
    items: [
      "Upload modern .xlsx workbooks and ask questions about their cell data.",
      "Request summaries across multiple worksheets, including hidden sheets.",
      "Large or row-dense workbooks are safely trimmed by complete populated rows.",
    ],
  },
];

export function announcementStorageKey(userId: string): string {
  return `notesrag:whats-new:${userId}`;
}

export function isLatestAnnouncementUnread(lastSeenId: string | null): boolean {
  const latest = FEATURE_ANNOUNCEMENTS[0];
  return Boolean(latest && latest.id !== lastSeenId);
}
