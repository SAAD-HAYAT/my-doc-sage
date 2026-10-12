import type { Workbook } from "exceljs";

export type GeneratedFileFormat = "xlsx" | "pdf" | "md";
export type GeneratedCellValue = string | number | boolean | null;

export interface GeneratedWorksheet {
  name: string;
  rows: GeneratedCellValue[][];
}

export type GeneratedFilePayload =
  | { format: "xlsx"; name: string; sheets: GeneratedWorksheet[] }
  | { format: "pdf" | "md"; name: string; content: string };

export interface DownloadableFile {
  name: string;
  mimeType: string;
  url: string;
}

export interface FileClarification {
  prompt: string;
  format: GeneratedFileFormat;
  mode: "generate" | "categorize-workbook";
  question: string;
  options: [string, string];
}

export function fileClarificationFor(message: string): FileClarification | null {
  const format = requestedFileFormat(message);
  if (!format) return null;
  if (isCategorizationRequest(message)) {
    return {
      prompt: message,
      format,
      mode: "categorize-workbook",
      question: "How should the workbook be divided into four worksheets?",
      options: [
        "Production, Maintenance, Administration, and Logistics",
        "Use the four values already present in a Category column",
      ],
    };
  }
  if (format === "xlsx") {
    if (/\b(?:one|single)\s+(?:summary\s+)?worksheet\b|\bseparate\s+worksheets?\b/i.test(message)) {
      return null;
    }
    return {
      prompt: message,
      format,
      mode: "generate",
      question: "How should the Excel workbook be organized?",
      options: ["One concise summary worksheet", "Separate worksheets by topic"],
    };
  }
  if (/\b(?:concise|brief|detailed|comprehensive)\b/i.test(message)) return null;
  return {
    prompt: message,
    format,
    mode: "generate",
    question: `What level of detail should the ${format === "pdf" ? "PDF" : "Markdown"} document use?`,
    options: ["Concise summary with headings", "Detailed report with supporting sections"],
  };
}

async function createWorkbook(): Promise<Workbook> {
  const excelJs = await import("exceljs");
  return new excelJs.default.Workbook();
}

function safeSheetName(value: string, used: Set<string>): string {
  const base =
    value
      .replace(/[\\/*?:[\]]/g, "-")
      .trim()
      .slice(0, 31) || "Sheet";
  let name = base;
  let suffix = 2;
  while (used.has(name.toLocaleLowerCase("en-US"))) {
    const marker = ` (${suffix})`;
    name = `${base.slice(0, 31 - marker.length)}${marker}`;
    suffix += 1;
  }
  used.add(name.toLocaleLowerCase("en-US"));
  return name;
}

async function workbookBytes(sheets: GeneratedWorksheet[]): Promise<Uint8Array> {
  const workbook = await createWorkbook();
  workbook.creator = "NotesRAG";
  workbook.created = new Date();
  const usedNames = new Set<string>();

  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(safeSheetName(sheet.name, usedNames));
    for (const row of sheet.rows) worksheet.addRow(row);
    if (sheet.rows.length > 0) {
      const header = worksheet.getRow(1);
      header.font = { bold: true, color: { argb: "FFFFFFFF" } };
      header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
      header.alignment = { vertical: "middle" };
      header.height = 22;
      worksheet.views = [{ state: "frozen", ySplit: 1 }];
      const width = Math.max(1, ...sheet.rows.map((row) => row.length));
      worksheet.autoFilter = { from: "A1", to: worksheet.getRow(1).getCell(width).address };
      for (let column = 1; column <= width; column += 1) {
        worksheet.getColumn(column).width = 18;
      }
    }
  }

  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function plainTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[-*]\s+/gm, "- ");
}

function safePdfText(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\xFF]/g, "?");
}

async function pdfBytes(markdown: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 54;
  const fontSize = 10.5;
  const lineHeight = 15;
  const maxWidth = pageWidth - margin * 2;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const addLine = (line: string, isHeading: boolean) => {
    const activeFont = isHeading ? bold : font;
    const activeSize = isHeading ? 14 : fontSize;
    const safeLine = safePdfText(line);
    const words = safeLine.split(/\s+/).filter(Boolean);
    const wrapped: string[] = [];
    let current = "";
    for (const word of words.length > 0 ? words : [""]) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && activeFont.widthOfTextAtSize(candidate, activeSize) > maxWidth) {
        wrapped.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    wrapped.push(current);

    for (const part of wrapped) {
      if (y < margin + lineHeight) {
        page = pdf.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      page.drawText(part, {
        x: margin,
        y,
        size: activeSize,
        font: activeFont,
        color: rgb(0.12, 0.16, 0.23),
      });
      y -= isHeading ? 20 : lineHeight;
    }
    if (!line) y -= lineHeight / 2;
  };

  for (const rawLine of markdown.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+/.test(rawLine);
    addLine(plainTextFromMarkdown(rawLine), heading);
  }

  return new Uint8Array(await pdf.save({ useObjectStreams: true }));
}

function objectUrl(bytes: Uint8Array | string, mimeType: string): string {
  const part = typeof bytes === "string" ? bytes : Uint8Array.from(bytes);
  return URL.createObjectURL(new Blob([part], { type: mimeType }));
}

export async function createDownloadableFile(
  payload: GeneratedFilePayload,
): Promise<DownloadableFile> {
  if (payload.format === "xlsx") {
    return {
      name: payload.name,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      url: objectUrl(
        await workbookBytes(payload.sheets),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    };
  }
  if (payload.format === "pdf") {
    return {
      name: payload.name,
      mimeType: "application/pdf",
      url: objectUrl(await pdfBytes(payload.content), "application/pdf"),
    };
  }
  return {
    name: payload.name,
    mimeType: "text/markdown;charset=utf-8",
    url: objectUrl(payload.content, "text/markdown;charset=utf-8"),
  };
}

export function requestedFileFormat(message: string): GeneratedFileFormat | null {
  if (!/\b(?:create|generate|make|export|produce|build)\b/i.test(message)) return null;
  if (/\b(?:excel|xlsx|spreadsheet|workbook)\b/i.test(message)) return "xlsx";
  if (/\bpdf\b/i.test(message)) return "pdf";
  if (/\b(?:markdown|md)\b/i.test(message)) return "md";
  return null;
}

export function isCategorizationRequest(message: string): boolean {
  return (
    requestedFileFormat(message) === "xlsx" &&
    (/\b(?:categor(?:ize|ise|ized|ised|ization)|sort|group)\b/i.test(message) ||
      (/\b(?:separate|split)\b/i.test(message) &&
        /\b(?:department|category|categories)\b/i.test(message)))
  );
}
