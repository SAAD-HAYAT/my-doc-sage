export const MAX_UPLOAD_SIZE_BYTES = 4 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_LABEL = "4 MB";
export const FILE_SIZE_TOO_LARGE_MESSAGE = "File size too large";

export function isUploadTooLarge(size: number): boolean {
  return size >= MAX_UPLOAD_SIZE_BYTES;
}
