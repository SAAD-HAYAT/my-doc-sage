import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { chunkText, countTokens, MAX_EMBED_TOKENS, splitToTokenLimit } from "@/lib/chunking";
import { prepareDocumentUpload } from "@/lib/document-trimming";
import { formatTrimmedRange, isUploadTooLarge, MAX_UPLOAD_SIZE_BYTES } from "@/lib/document-upload";
import {
  EXCEL_MIME_TYPE,
  extractSpreadsheetText,
  readSpreadsheetRows,
  trimSpreadsheetToSize,
} from "@/lib/spreadsheet";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("Usage: npm run verify:excel -- <path-to-workbook.xlsx>");
}

const absolutePath = resolve(inputPath);
if (!absolutePath.toLowerCase().endsWith(".xlsx")) {
  throw new Error("Excel verification only accepts .xlsx workbooks");
}

const source = Uint8Array.from(await readFile(absolutePath));
const rows = await readSpreadsheetRows(source);
if (rows.length === 0) throw new Error("Workbook had no extractable rows");

const text = await extractSpreadsheetText(source);
const chunks = chunkText(text).flatMap((chunk) => splitToTokenLimit(chunk));
const maxChunkTokens = Math.max(...chunks.map((chunk) => countTokens(chunk)));
if (maxChunkTokens > MAX_EMBED_TOKENS) {
  throw new Error(`A chunk exceeded the embedding limit: ${maxChunkTokens} tokens`);
}

const uploadFile = new File([source], basename(absolutePath), { type: EXCEL_MIME_TYPE });
const productionUpload = await prepareDocumentUpload(uploadFile);
if (isUploadTooLarge(source.byteLength)) {
  if (productionUpload.file.size >= MAX_UPLOAD_SIZE_BYTES) {
    throw new Error("Production upload preparation did not reduce the workbook below 4 MB");
  }
} else if (productionUpload.file !== uploadFile || productionUpload.trimmed !== null) {
  throw new Error("A workbook below 4 MB was modified unexpectedly");
}

// Exercise the oversized-workbook path even when the supplied fixture is
// naturally below 4 MB. The reduced cap is derived from the normalized output
// so this remains deterministic across workbooks and ExcelJS releases.
const normalized = await trimSpreadsheetToSize(source, Number.MAX_SAFE_INTEGER);
const forcedLimit = Math.max(8_000, Math.floor(normalized.bytes.byteLength * 0.65));
let forcedTrim: {
  limitBytes: number;
  outputBytes: number;
  label: string;
  prefixVerified: true;
} | null = null;

if (forcedLimit < normalized.bytes.byteLength) {
  const trimmed = await trimSpreadsheetToSize(source, forcedLimit);
  const retainedRows = await readSpreadsheetRows(trimmed.bytes);
  if (trimmed.bytes.byteLength >= forcedLimit) {
    throw new Error("Trimmed workbook exceeded the forced verification limit");
  }
  if (retainedRows.length !== trimmed.includedRows) {
    throw new Error("Retained row count did not match trim metadata");
  }

  const rowSignature = (row: (typeof rows)[number]) => [
    row.sheetName,
    row.sheetState,
    row.rowNumber,
    row.cells.map((cell) => [cell.column, cell.text]),
  ];
  const expectedPrefix = rows.slice(0, trimmed.includedRows).map(rowSignature);
  const actualPrefix = retainedRows.map(rowSignature);
  if (JSON.stringify(expectedPrefix) !== JSON.stringify(actualPrefix)) {
    throw new Error("Trimmed workbook did not preserve the exact populated-row prefix");
  }

  const forcedPrepared = await prepareDocumentUpload(uploadFile, forcedLimit);
  if (!forcedPrepared.trimmed || forcedPrepared.trimmed.unit !== "rows") {
    throw new Error("Upload preparation did not report row trimming");
  }

  forcedTrim = {
    limitBytes: forcedLimit,
    outputBytes: forcedPrepared.file.size,
    label: formatTrimmedRange(forcedPrepared.trimmed),
    prefixVerified: true,
  };
}

const sheets = [...new Map(rows.map((row) => [row.sheetName, row.sheetState])).entries()].map(
  ([name, state]) => ({ name, state }),
);

console.log(
  JSON.stringify(
    {
      file: basename(absolutePath),
      sourceBytes: source.byteLength,
      sheets,
      populatedRows: rows.length,
      extractedCharacters: text.length,
      chunks: chunks.length,
      maxChunkTokens,
      productionUpload: productionUpload.trimmed
        ? formatTrimmedRange(productionUpload.trimmed)
        : "unchanged (below 4 MB)",
      forcedTrim,
    },
    null,
    2,
  ),
);
