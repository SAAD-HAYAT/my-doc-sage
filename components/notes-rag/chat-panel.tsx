"use client";

import { BookOpen, ChevronDown, FileUp } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatSource } from "@/lib/notes-rag-api";

interface ChatPanelProps {
  messages: ChatMessage[];
  sending: boolean;
  hasDocuments: boolean;
  onSend: (text: string) => void;
  onOpenSidebar: () => void;
}

function SourcesList({ sources }: { sources: ChatSource[] }) {
  if (!sources.length) return null;
  return (
    <Collapsible className="mt-1 max-w-lg">
      <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <BookOpen className="size-3" />
        Sources ({sources.length})
        <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 space-y-2">
          {sources.map((s, i) => (
            <li
              key={i}
              className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{s.documentName}</span>
                <span className="shrink-0 text-muted-foreground">
                  {Math.round(s.score * 100)}% match
                </span>
              </div>
              <p className="mt-1 line-clamp-3 text-muted-foreground">
                {s.chunkText}
              </p>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function EmptyState({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-muted">
        <FileUp className="size-5 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">Upload your first document</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        NotesRAG answers questions using your own documents. Upload a PDF or
        Markdown file in the sidebar, then ask anything.
      </p>
      <button
        type="button"
        onClick={onOpenSidebar}
        className="text-sm font-medium text-primary underline-offset-4 hover:underline md:hidden"
      >
        Open the sidebar to upload
      </button>
    </div>
  );
}

export function ChatPanel({
  messages,
  sending,
  hasDocuments,
  onSend,
  onOpenSidebar,
}: ChatPanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 && !hasDocuments ? (
        <EmptyState onOpenSidebar={onOpenSidebar} />
      ) : (
        <Conversation className="flex-1">
          <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6">
            {messages.length === 0 && (
              <p className="pt-10 text-center text-sm text-muted-foreground">
                Ask a question about your documents to start the conversation.
              </p>
            )}
            {messages.map((msg, i) => (
              <Message key={i} from={msg.role}>
                <MessageContent
                  className={cn(
                    msg.role === "user" &&
                      "rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground",
                  )}
                >
                  {msg.role === "assistant" ? (
                    <>
                      <MessageResponse>{msg.content}</MessageResponse>
                      {msg.sources && <SourcesList sources={msg.sources} />}
                    </>
                  ) : (
                    msg.content
                  )}
                </MessageContent>
              </Message>
            ))}
            {sending && (
              <Message from="assistant">
                <MessageContent>
                  <Shimmer className="text-sm">Thinking…</Shimmer>
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      )}

      {/* Composer */}
      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          <PromptInput
            onSubmit={(message) => {
              const text = message.text.trim();
              if (text && !sending) onSend(text);
            }}
          >
            <PromptInputTextarea
              placeholder={
                hasDocuments
                  ? "Ask about your documents…"
                  : "Upload a document first…"
              }
              disabled={!hasDocuments || sending}
            />
            <PromptInputFooter className="justify-end">
              <PromptInputSubmit
                {...(sending ? { status: "submitted" as const } : {})}
                disabled={!hasDocuments || sending}
              />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}