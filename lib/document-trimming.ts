import { isUploadTooLarge, MAX_UPLOAD_SIZE_BYTES, type TrimmedRange } from "@/lib/document-upload";
import { EXCEL_MIME_TYPE, isExcelFile, trimSpreadsheetToSize } from "@/lib/spreadsheet";
import type { PDFDocument as PdfLibDocument } from "pdf-lib";

export interface PreparedDocumentUpload {
  file: File;
  trimmed: TrimmedRange | null;
  wasOptimized: boolean;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split(/\r\n|\r|\n/).length;
  return /(?:\r\n|\r|\n)$/.test(text) ? lines - 1 : lines;
}

async function buildPdfPrefix(source: PdfLibDocument, pageCount: number): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const output = await PDFDocument.create();
  const indices = Array.from({ length: pageCount }, (_, index) => index);
  const pages = await output.copyPages(source, indices);
  for (const page of pages) output.addPage(page);
  return output.save({ useObjectStreams: true });
}

async function trimPdf(file: File, maxBytes: number): Promise<PreparedDocumentUpload> {
  const { PDFDocument } = await import("pdf-lib");
  const source = await PDFDocument.load(await file.arrayBuffer());
  const total = source.getPageCount();
  if (total === 0) throw new Error("The PDF has no pages");

  let low = 1;
  let high = total;
  let included = 0;
  let best: Uint8Array | null = null;

  // Output size is monotonic for ordinary PDFs: copying more source pages
  // adds page objects/resources. Binary search avoids repeatedly rebuilding
  // every possible prefix for a large document.
  while (low <= high) {
    const candidateCount = Math.floor((low + high) / 2);
    const candidate = await buildPdfPrefix(source, candidateCount);
    if (candidate.byteLength < maxBytes) {
      included = candidateCount;
      best = candidate;
      low = candidateCount + 1;
    } else {
      high = candidateCount - 1;
    }
  }

  if (!best || included === 0) {
    throw new Error("The first PDF page is too large to fit within 4 MB");
  }

  const bytes = Uint8Array.from(best);
  return {
    file: new File([bytes], file.name, {
      type: "application/pdf",
      lastModified: file.lastModified,
    }),
    trimmed: included < total ? { unit: "pages", included, total } : null,
    wasOptimized: included === total,
  };
}

async function trimMarkdown(file: File, maxBytes: number): Promise<PreparedDocumentUpload> {
  const text = await file.text();
  const encoder = new TextEncoder();
  let low = 0;
  let high = text.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(text.slice(0, middle)).byteLength < maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  const byteSizedPrefix = text.slice(0, low);
  const lastLineBreak = Math.max(
    byteSizedPrefix.lastIndexOf("\n"),
    byteSizedPrefix.lastIndexOf("\r"),
  );
  if (lastLineBreak < 0) {
    throw new Error("The first Markdown line is too large to fit within 4 MB");
  }

  // Keep complete lines only so the persisted line count accurately describes
  // exactly how much context the chatbot received.
  const prefix = byteSizedPrefix.slice(0, lastLineBreak + 1);
  const trimmed: TrimmedRange = {
    unit: "lines",
    included: countLines(prefix),
    total: countLines(text),
  };

  return {
    file: new File([prefix], file.name, {
      type: file.type || "text/markdown",
      lastModified: file.lastModified,
    }),
    trimmed,
    wasOptimized: false,
  };
}

async function trimSpreadsheet(file: File, maxBytes: number): Promise<PreparedDocumentUpload> {
  const result = await trimSpreadsheetToSize(await file.arrayBuffer(), maxBytes);
  const wasOptimized = result.includedRows === result.totalRows;
  const bytes = Uint8Array.from(result.bytes);
  return {
    file: new File([bytes], file.name, {
      type: EXCEL_MIME_TYPE,
      lastModified: file.lastModified,
    }),
    trimmed: wasOptimized
      ? null
      : { unit: "rows", included: result.includedRows, total: result.totalRows },
    wasOptimized,
  };
}

export async function prepareDocumentUpload(
  file: File,
  maxBytes = MAX_UPLOAD_SIZE_BYTES,
): Promise<PreparedDocumentUpload> {
  if (!isUploadTooLarge(file.size) && file.size < maxBytes) {
    return { file, trimmed: null, wasOptimized: false };
  }

  if (isPdf(file)) return trimPdf(file, maxBytes);
  if (isExcelFile(file)) return trimSpreadsheet(file, maxBytes);
  return trimMarkdown(file, maxBytes);
}
