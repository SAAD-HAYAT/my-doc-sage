import { describe, expect, it } from "vitest";
import { formatTrimmedRange, isUploadTooLarge, MAX_UPLOAD_SIZE_BYTES } from "@/lib/document-upload";

describe("document upload limits", () => {
  it("allows a file one byte below the limit", () => {
    expect(isUploadTooLarge(MAX_UPLOAD_SIZE_BYTES - 1)).toBe(false);
  });

  it("rejects a file at or above the limit", () => {
    expect(isUploadTooLarge(MAX_UPLOAD_SIZE_BYTES)).toBe(true);
    expect(isUploadTooLarge(MAX_UPLOAD_SIZE_BYTES + 1)).toBe(true);
  });

  it("formats the persistent PDF context label", () => {
    expect(formatTrimmedRange({ unit: "pages", included: 12, total: 30 })).toBe(
      "Trimmed: pages 1–12 of 30",
    );
  });
});
