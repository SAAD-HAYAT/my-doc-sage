import { describe, expect, it } from "vitest";
import {
  createDownloadableFile,
  fileClarificationFor,
  isCategorizationRequest,
  requestedFileFormat,
} from "@/lib/generated-files";
import ExcelJS from "exceljs";

describe("chat-triggered file generation", () => {
  it("detects explicit Excel, PDF, and Markdown generation requests", () => {
    expect(requestedFileFormat("Create an Excel workbook from my notes")).toBe("xlsx");
    expect(requestedFileFormat("Generate a PDF report")).toBe("pdf");
    expect(requestedFileFormat("Make a markdown file")).toBe("md");
    expect(requestedFileFormat("Explain this PDF")).toBeNull();
  });

  it("uses the workbook categorization clarification for sorting requests", () => {
    const result = fileClarificationFor(
      "Create an Excel file and separate the departments into four categories",
    );
    expect(isCategorizationRequest(result?.prompt ?? "")).toBe(true);
    expect(result).toMatchObject({
      format: "xlsx",
      mode: "categorize-workbook",
      options: [
        "Production, Maintenance, Administration, and Logistics",
        "Use the four values already present in a Category column",
      ],
    });
  });

  it("provides exactly two suggestions while leaving custom input to the UI", () => {
    expect(fileClarificationFor("Generate a PDF report")?.options).toHaveLength(2);
    expect(fileClarificationFor("Generate an Excel workbook")?.options).toHaveLength(2);
  });

  it("does not ask when the prompt already includes the relevant specification", () => {
    expect(fileClarificationFor("Generate a detailed PDF report")).toBeNull();
    expect(
      fileClarificationFor("Create an Excel workbook with separate worksheets by topic"),
    ).toBeNull();
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
      ],
    });
    const excelBytes = await (await fetch(excel.url)).arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(excelBytes);
    expect(workbook.getWorksheet("Summary")?.getCell("B2").value).toBe(100);

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
