import { createCanvas, loadImage, PDFDocument } from "@napi-rs/canvas";
import { extractPdfText } from "../lib/pdf-text";

const width = 1400;
const height = 500;
const canvas = createCanvas(width, height);
const context = canvas.getContext("2d");
context.fillStyle = "white";
context.fillRect(0, 0, width, height);
context.fillStyle = "black";
context.font = "bold 72px sans-serif";
context.fillText("OCR INTEGRATION WORKS", 90, 210);
context.font = "52px sans-serif";
context.fillText("Scanned document test 2026", 90, 320);

const image = await loadImage(await canvas.encode("png"));
const pdf = new PDFDocument();
const page = pdf.beginPage(width, height);
(page as unknown as typeof context).drawImage(image, 0, 0, width, height);
pdf.endPage();

const extracted = await extractPdfText(new Uint8Array(pdf.close()));
if (!extracted.toUpperCase().includes("OCR INTEGRATION WORKS")) {
  throw new Error(`OCR verification failed. Extracted: ${extracted}`);
}

console.log(extracted.trim());
