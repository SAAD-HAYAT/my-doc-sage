export const MAX_UPLOAD_SIZE_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_LABEL = "4 MB";
export const FILE_SIZE_TOO_LARGE_MESSAGE = "File size too large";

export type TrimmedUnit = "pages" | "lines";

export interface TrimmedRange {
  unit: TrimmedUnit;
  included: number;
  total: number;
}

export function isUploadTooLarge(size: number): boolean {
  return size >= MAX_UPLOAD_SIZE_BYTES;
}

export function formatTrimmedRange(trimmed: TrimmedRange): string {
  return `Trimmed: ${trimmed.unit} 1–${trimmed.included} of ${trimmed.total}`;
}
