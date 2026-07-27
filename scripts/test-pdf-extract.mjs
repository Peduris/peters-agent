/**
 * Smoke-test unpdf PDF text extraction (Node/serverless-safe path).
 * Run: npm run test:pdf
 */
import { extractText } from "unpdf";

/** Minimal one-page PDF with Helvetica text "Peter CV Sample". */
function buildMinimalPdf() {
  const content = "BT /F1 24 Tf 72 720 Td (Peter CV Sample) Tj ET";
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${content.length} >>stream\n${content}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += obj;
  }

  const xrefStart = Buffer.byteLength(body, "utf8");
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

const pdfBytes = new Uint8Array(buildMinimalPdf());

try {
  const { text, totalPages } = await extractText(pdfBytes, { mergePages: true });
  const merged = typeof text === "string" ? text : (text ?? []).join("\n");
  if (!merged.includes("Peter CV Sample")) {
    console.error("FAIL: expected text not found. Got:", JSON.stringify(merged));
    process.exit(1);
  }
  console.log(`OK: extracted "${merged.trim()}" from ${totalPages} page(s)`);
} catch (err) {
  console.error("FAIL:", err);
  process.exit(1);
}
