import { describe, expect, it } from "vitest";
import { isUploadTooLarge, MAX_UPLOAD_SIZE_BYTES } from "@/lib/document-upload";

describe("document upload limits", () => {
  it("allows a file one byte below the limit", () => {
    expect(isUploadTooLarge(MAX_UPLOAD_SIZE_BYTES - 1)).toBe(false);
  });

  it("rejects a file at or above the limit", () => {
    expect(isUploadTooLarge(MAX_UPLOAD_SIZE_BYTES)).toBe(true);
    expect(isUploadTooLarge(MAX_UPLOAD_SIZE_BYTES + 1)).toBe(true);
  });
});
