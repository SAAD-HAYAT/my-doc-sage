import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractText: vi.fn(),
  getDocumentProxy: vi.fn(),
  renderPageAsImage: vi.fn(),
  createWorker: vi.fn(),
}));

vi.mock("unpdf", () => ({
  extractText: mocks.extractText,
  getDocumentProxy: mocks.getDocumentProxy,
  renderPageAsImage: mocks.renderPageAsImage,
}));

vi.mock("tesseract.js", () => ({ createWorker: mocks.createWorker }));

import { extractPdfText } from "@/lib/pdf-text";

describe("extractPdfText", () => {
  const pdf = {
    cleanup: vi.fn(async () => {}),
    loadingTask: { destroy: vi.fn(async () => {}) },
  };
  const worker = {
    recognize: vi.fn(),
    terminate: vi.fn(async () => {}),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDocumentProxy.mockResolvedValue(pdf);
    mocks.createWorker.mockResolvedValue(worker);
  });

  it("keeps useful embedded text on the fast path without starting OCR", async () => {
    mocks.extractText.mockResolvedValue({
      totalPages: 2,
      text: [
        "This page has a complete embedded text layer.",
        "This second page also has enough native text.",
      ],
    });

    const text = await extractPdfText(new Uint8Array([1, 2, 3]));

    expect(text).toContain("complete embedded text layer");
    expect(mocks.createWorker).not.toHaveBeenCalled();
    expect(mocks.renderPageAsImage).not.toHaveBeenCalled();
    expect(pdf.cleanup).toHaveBeenCalledOnce();
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it("OCRs only sparse pages and preserves native text in a mixed PDF", async () => {
    mocks.extractText.mockResolvedValue({
      totalPages: 2,
      text: ["A normal page with enough embedded text to keep.", "  2  "],
    });
    mocks.renderPageAsImage.mockResolvedValue(Uint8Array.from([137, 80, 78, 71]).buffer);
    worker.recognize.mockResolvedValue({
      data: { text: "Text recovered from the scanned page." },
    });

    const text = await extractPdfText(new Uint8Array([1, 2, 3]));

    expect(mocks.createWorker).toHaveBeenCalledWith(
      "eng",
      undefined,
      expect.objectContaining({
        cachePath: expect.stringContaining("notesrag-tesseract-cache"),
      }),
    );
    expect(mocks.renderPageAsImage).toHaveBeenCalledWith(
      pdf,
      2,
      expect.objectContaining({ scale: 2 }),
    );
    expect(worker.recognize).toHaveBeenCalledWith(expect.any(Buffer));
    expect(text).toBe(
      "A normal page with enough embedded text to keep.\n\nText recovered from the scanned page.",
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(pdf.cleanup).toHaveBeenCalledOnce();
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce();
  });

  it("releases the OCR worker and PDF if recognition fails", async () => {
    mocks.extractText.mockResolvedValue({ totalPages: 1, text: [""] });
    mocks.renderPageAsImage.mockResolvedValue(new ArrayBuffer(1));
    worker.recognize.mockRejectedValue(new Error("OCR failed"));

    await expect(extractPdfText(new Uint8Array([1]))).rejects.toThrow("OCR failed");

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(pdf.cleanup).toHaveBeenCalledOnce();
    expect(pdf.loadingTask.destroy).toHaveBeenCalledOnce();
  });
});
