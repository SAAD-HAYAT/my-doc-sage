import { describe, expect, it } from "vitest";
import { createDownloadableFile, requestedFileFormat } from "@/lib/generated-files";
import ExcelJS from "exceljs";

describe("chat-triggered file generation", () => {
  it("detects explicit Excel, PDF, and Markdown generation requests", () => {
    expect(requestedFileFormat("Create an Excel workbook from my notes")).toBe("xlsx");
    expect(requestedFileFormat("Generate a PDF report")).toBe("pdf");
    expect(requestedFileFormat("Make a markdown file")).toBe("md");
    expect(requestedFileFormat("Explain this PDF")).toBeNull();
  });

  it("builds valid downloadable Excel, PDF, and Markdown files", async () => {
    const excel = await createDownloadableFile({
      format: "xlsx",
      name: "report.xlsx",
      sheets: [
        {
          name: "Summary",
          rows: [
            ["Metric", "Value"],
            ["Revenue", 100],
          ],
        },
        {
          name: "Details",
          rows: [
            ["Item", "Amount"],
            ["A", 60],
            ["B", 40],
          ],
        },
      ],
    });
    const excelBytes = await (await fetch(excel.url)).arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelBytes);
    expect(workbook.getWorksheet("Summary")?.getCell("B2").value).toBe(100);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Details"]);
    expect(workbook.getWorksheet("Details")?.getCell("B3").value).toBe(40);

    const pdf = await createDownloadableFile({
      format: "pdf",
      name: "report.pdf",
      content: "# Résumé — report\n\n- Revenue was 100.",
    });
    const pdfBytes = new Uint8Array(await (await fetch(pdf.url)).arrayBuffer());
    expect(new TextDecoder().decode(pdfBytes.slice(0, 5))).toBe("%PDF-");

    const markdown = await createDownloadableFile({
      format: "md",
      name: "report.md",
      content: "# Report",
    });
    expect(await (await fetch(markdown.url)).text()).toBe("# Report");

    URL.revokeObjectURL(excel.url);
    URL.revokeObjectURL(pdf.url);
    URL.revokeObjectURL(markdown.url);
  });
});
