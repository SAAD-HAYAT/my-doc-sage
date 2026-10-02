import { describe, expect, it } from "vitest";
import {
  announcementStorageKey,
  FEATURE_ANNOUNCEMENTS,
  isLatestAnnouncementUnread,
} from "@/lib/announcements";

describe("What's new announcements", () => {
  it("uses a separate browser key for every authenticated user", () => {
    expect(announcementStorageKey("user-a")).toBe("notesrag:whats-new:user-a");
    expect(announcementStorageKey("user-a")).not.toBe(announcementStorageKey("user-b"));
  });

  it("marks only the latest release id as read", () => {
    expect(isLatestAnnouncementUnread(null)).toBe(true);
    expect(isLatestAnnouncementUnread("older-release")).toBe(true);
    expect(isLatestAnnouncementUnread(FEATURE_ANNOUNCEMENTS[0].id)).toBe(false);
  });
});
