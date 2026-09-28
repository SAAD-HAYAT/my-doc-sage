import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MIN_NATIVE_TEXT_CHARACTERS = 20;
const OCR_RENDER_SCALE = 2;

function hasUsefulNativeText(text: string): boolean {
  return text.replace(/\s/g, "").length >= MIN_NATIVE_TEXT_CHARACTERS;
}

/**
 * Extracts each PDF page independently. Pages with a useful embedded text
 * layer stay on the fast PDF.js path; image-only (or nearly empty) pages are
 * rendered and passed through Tesseract instead. This also handles mixed PDFs
 * where only some pages are scans.
 */
export async function extractPdfText(data: Uint8Array): Promise<string> {
  // Use unpdf's default serverless build. Its PDF.js worker is inlined, so
  // Vercel does not need to locate a separate pdf.worker.mjs at runtime.
  const pdf = await getDocumentProxy(data, {
    maxImageSize: 16_777_216,
  });

  try {
    const { text: nativePages } = await extractText(pdf, {
      mergePages: false,
    });
    const pages = [...nativePages];
    const pagesNeedingOcr = pages
      .map((text, index) => (hasUsefulNativeText(text) ? -1 : index))
      .filter((index) => index >= 0);

    if (pagesNeedingOcr.length === 0) {
      return pages.join("\n\n");
    }

    const { createWorker } = await import("tesseract.js");
    const cachePath = join(tmpdir(), "notesrag-tesseract-cache");
    await mkdir(cachePath, { recursive: true });
    const worker = await createWorker("eng", undefined, { cachePath });

    try {
      for (const pageIndex of pagesNeedingOcr) {
        const image = await renderPageAsImage(pdf, pageIndex + 1, {
          canvasImport: () => import("@napi-rs/canvas"),
          scale: OCR_RENDER_SCALE,
        });
        const result = await worker.recognize(Buffer.from(image));
        pages[pageIndex] = result.data.text;
      }
    } finally {
      await worker.terminate();
    }

    return pages.join("\n\n");
  } finally {
    await pdf.cleanup();
    await pdf.loadingTask.destroy();
  }
}
