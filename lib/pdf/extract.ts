import { extractText } from "unpdf";

/**
 * Extract plain text from a PDF buffer using unpdf's serverless PDF.js build.
 * Safe for Vercel Node.js serverless (no DOMMatrix / canvas requirement).
 */
export async function extractPdfText(data: Uint8Array | Buffer): Promise<string> {
  const bytes = data instanceof Buffer ? new Uint8Array(data) : data;
  // Passing bytes (not a proxy) lets unpdf create + destroy the document for us.
  const { text } = await extractText(bytes, { mergePages: true });
  return text.trim();
}
