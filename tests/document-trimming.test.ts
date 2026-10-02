import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { prepareDocumentUpload } from "@/lib/document-trimming";

async function makePdf(pageCount: number): Promise<File> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page = pdf.addPage();
    for (let row = 0; row < 100; row += 1) {
      page.drawText(`page-${pageIndex + 1} row-${row + 1} ${"x".repeat(80)}`, {
        x: 20,
        y: 800 - row * 7,
        size: 6,
        font,
      });
    }
  }

  const bytes = await pdf.save({ useObjectStreams: true });
  return new File([Uint8Array.from(bytes)], "large.pdf", {
    type: "application/pdf",
  });
}

describe("document upload preparation", () => {
  it("leaves files below the limit unchanged", async () => {
    const file = new File(["small"], "notes.md", { type: "text/markdown" });

    const result = await prepareDocumentUpload(file, 100);

    expect(result.file).toBe(file);
    expect(result.trimmed).toBeNull();
    expect(result.wasOptimized).toBe(false);
  });

  it("keeps the largest complete PDF page prefix below the limit", async () => {
    const file = await makePdf(8);

    const result = await prepareDocumentUpload(file, 10_000);
    const output = await PDFDocument.load(await result.file.arrayBuffer());

    expect(result.file.size).toBeLessThan(10_000);
    expect(result.trimmed).toEqual({
      unit: "pages",
      included: output.getPageCount(),
      total: 8,
    });
    expect(output.getPageCount()).toBeGreaterThan(0);
    expect(output.getPageCount()).toBeLessThan(8);
  });

  it("keeps complete Markdown lines from the beginning", async () => {
    const source = "first line\nsecond line\nthird line\nfourth line\n";
    const file = new File([source], "notes.md", { type: "text/markdown" });

    const result = await prepareDocumentUpload(file, 30);

    expect(result.file.size).toBeLessThan(30);
    expect(await result.file.text()).toBe("first line\nsecond line\n");
    expect(result.trimmed).toEqual({ unit: "lines", included: 2, total: 4 });
  });

  it("keeps complete populated Excel rows from the beginning", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Rows");
    sheet.addRow(["Key", "Value"]);
    for (let index = 1; index <= 250; index += 1) {
      sheet.addRow([
        `row-${index}`,
        Array.from({ length: 20 }, (_, part) => `${index}-${part}-${index * 104729 + part}`).join(
          " ",
        ),
      ]);
    }
    const source = new Uint8Array(await workbook.xlsx.writeBuffer());
    const file = new File([source], "large.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const result = await prepareDocumentUpload(file, 10_000);

    expect(result.file.name).toBe("large.xlsx");
    expect(result.file.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(result.file.size).toBeLessThan(10_000);
    expect(result.trimmed?.unit).toBe("rows");
    expect(result.trimmed?.included).toBeGreaterThan(0);
    expect(result.trimmed?.included).toBeLessThan(result.trimmed?.total ?? 0);
    expect(result.wasOptimized).toBe(false);
  });
});
