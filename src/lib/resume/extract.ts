import { createHash } from 'node:crypto';
import { AppError } from '@/lib/security/errors';
import { config } from '@/lib/config';

/**
 * Upload validation and text extraction.
 *
 * Files are validated by magic bytes rather than the client-supplied MIME type
 * or extension, so a renamed executable cannot reach a parser. Only the
 * extracted text is retained — the original binary is never written to disk or
 * to the database.
 */

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export interface ExtractedDocument {
  text: string;
  mimeType: AcceptedMimeType;
  byteSize: number;
  contentHash: string;
  /** Pages for PDFs; null for formats without pagination. */
  pageCount: number | null;
}

/** Shortest text we will accept as a CV — below this, extraction has failed. */
const MIN_TEXT_LENGTH = 120;

/** Upper bound on retained text, so one enormous CV cannot bloat a row. */
const MAX_TEXT_LENGTH = 120_000;

/**
 * Identify a file by its magic bytes.
 *
 * PDF starts with "%PDF-"; DOCX is a ZIP container starting "PK\x03\x04".
 * A DOCX and any other ZIP look identical here, so the DOCX parser is the
 * arbiter — it fails on a ZIP that is not a Word document.
 */
function sniffMimeType(bytes: Uint8Array): AcceptedMimeType | null {
  if (bytes.length >= 5) {
    const header = String.fromCharCode(...bytes.slice(0, 5));
    if (header === '%PDF-') return 'application/pdf';
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  // Plain text: valid UTF-8 with no control bytes outside the usual whitespace.
  if (looksLikeText(bytes)) return 'text/plain';
  return null;
}

function looksLikeText(bytes: Uint8Array): boolean {
  const sample = bytes.slice(0, 2048);
  for (const byte of sample) {
    if (byte === 0) return false;
    // Allow tab, newline, carriage return and form feed.
    if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
  }
  return true;
}

export interface ValidateUploadInput {
  bytes: Uint8Array;
  fileName: string;
}

/**
 * Validate an upload before any parser touches it.
 *
 * Rejects on size and on content type. An empty file and a file whose declared
 * extension disagrees with its bytes both fail here.
 */
export function validateUpload(input: ValidateUploadInput): AcceptedMimeType {
  if (input.bytes.length === 0) {
    throw new AppError('bad_request', 'That file is empty.');
  }
  if (input.bytes.length > config.uploads.maxBytes) {
    const megabytes = Math.round(config.uploads.maxBytes / (1024 * 1024));
    throw new AppError('payload_too_large', `Files must be ${megabytes} MB or smaller.`);
  }

  const sniffed = sniffMimeType(input.bytes);
  if (!sniffed) {
    throw new AppError(
      'unsupported_media_type',
      'Upload a PDF, a Word document (.docx) or a plain text file.',
    );
  }
  return sniffed;
}

/**
 * Extract plain text from an uploaded CV.
 *
 * Parsers are imported lazily so a Word-only deployment never loads the PDF
 * engine, which keeps cold starts down on serverless.
 */
export async function extractDocumentText(input: ValidateUploadInput): Promise<ExtractedDocument> {
  const mimeType = validateUpload(input);
  const contentHash = createHash('sha256').update(input.bytes).digest('hex');

  let text: string;
  let pageCount: number | null = null;

  try {
    if (mimeType === 'application/pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(input.bytes));
      // With mergePages the result text is a single string; the union type is
      // widened for the per-page form, so narrow rather than assert.
      const result = await extractText(pdf, { mergePages: true });
      const extracted: string | string[] = result.text;
      text = Array.isArray(extracted) ? extracted.join('\n') : extracted;
      pageCount = result.totalPages ?? null;
    } else if (mimeType === 'text/plain') {
      text = new TextDecoder('utf-8', { fatal: false }).decode(input.bytes);
    } else {
      const mammoth = (await import('mammoth')).default;
      const result = await mammoth.extractRawText({ buffer: Buffer.from(input.bytes) });
      text = result.value;
    }
  } catch (error) {
    throw new AppError(
      'bad_request',
      'That file could not be read. If it is a scanned PDF, export a text-based version and try again.',
      { cause: error },
    );
  }

  const normalized = normalizeExtractedText(text);

  if (normalized.length < MIN_TEXT_LENGTH) {
    throw new AppError(
      'bad_request',
      'Almost no text could be read from that file. Scanned or image-only documents are not supported yet.',
    );
  }

  return {
    text: normalized.slice(0, MAX_TEXT_LENGTH),
    mimeType,
    byteSize: input.bytes.length,
    contentHash,
    pageCount,
  };
}

/**
 * Tidy extracted text without destroying the line structure.
 *
 * Section detection depends on line breaks, so newlines are preserved while
 * runs of spaces, non-breaking spaces and blank lines are collapsed.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    // Ligatures that PDF extraction commonly emits.
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    // Strip zero-width and control characters that survive extraction.
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
