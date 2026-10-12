export interface FeatureAnnouncement {
  id: string;
  date: string;
  title: string;
  items: string[];
}

export const FEATURE_ANNOUNCEMENTS: FeatureAnnouncement[] = [
  {
    id: "2026-10-12-workbook-categorization",
    date: "October 12, 2026",
    title: "Generate files from chat",
    items: [
      "Ask NotesRAG to create an Excel, PDF, or Markdown file.",
      "Choose between two suggested specifications or enter a custom option in the chat composer.",
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
