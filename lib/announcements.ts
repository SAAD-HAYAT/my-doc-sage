export interface FeatureAnnouncement {
  id: string;
  date: string;
  title: string;
  items: string[];
}

export const FEATURE_ANNOUNCEMENTS: FeatureAnnouncement[] = [
  {
    id: "2026-10-02-excel-support",
    date: "October 2, 2026",
    title: "Excel files are now supported",
    items: [
      "Upload modern .xlsx workbooks and ask questions about their cell data.",
      "Request summaries across multiple worksheets, including hidden sheets.",
      "Workbooks over 4 MB are optimized or trimmed by complete populated rows.",
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
