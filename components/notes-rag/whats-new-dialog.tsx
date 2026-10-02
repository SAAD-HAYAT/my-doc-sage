"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  announcementStorageKey,
  FEATURE_ANNOUNCEMENTS,
  isLatestAnnouncementUnread,
} from "@/lib/announcements";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

function readSeenId(key: string): string | null {
  try {
    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  } catch {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }
}

function writeSeenId(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
    return;
  } catch {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      // React state still prevents the indicator from returning this session.
    }
  }
}

export function WhatsNewDialog() {
  const latest = FEATURE_ANNOUNCEMENTS[0];
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [lastSeenId, setLastSeenId] = useState<string | null>(latest?.id ?? null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!active || !data.user || !latest) return;
        const id = data.user.id;
        const seenId = readSeenId(announcementStorageKey(id));
        setUserId(id);
        setLastSeenId(seenId);
        if (isLatestAnnouncementUnread(seenId)) setOpen(true);
      })
      .catch(() => {
        // The page is auth-protected; if session lookup still fails, leave the
        // manual release-history control available without breaking the page.
      });
    return () => {
      active = false;
    };
  }, [latest]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen && latest && userId) {
        writeSeenId(announcementStorageKey(userId), latest.id);
        setLastSeenId(latest.id);
      }
    },
    [latest, userId],
  );

  const unread = isLatestAnnouncementUnread(lastSeenId);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <span className="relative">
          <Sparkles className="size-3.5" />
          {unread && (
            <span
              className="absolute -right-1 -top-1 size-1.5 rounded-full bg-primary"
              aria-label="New announcement"
            />
          )}
        </span>
        What&apos;s new
      </Button>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>What&apos;s new in NotesRAG</DialogTitle>
          <DialogDescription>
            Recent improvements available in your document workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {FEATURE_ANNOUNCEMENTS.map((announcement) => (
            <section key={announcement.id} className="space-y-2">
              <div>
                <p className="text-sm font-semibold">{announcement.title}</p>
                <p className="text-xs text-muted-foreground">{announcement.date}</p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {announcement.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
