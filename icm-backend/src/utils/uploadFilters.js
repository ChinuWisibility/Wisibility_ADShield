/**
 * Shared multer fileFilter factories — reject uploads outside the expected
 * MIME/extension allowlist before they ever reach a parser or get buffered.
 */
import { AppError } from "../middleware/errorHandler.js";

const CSV_MIME_TYPES = new Set([
  "text/csv",
  "application/vnd.ms-excel",
  "application/csv",
  "text/plain", // some browsers/OSes send CSV as text/plain
  "application/octet-stream", // generic fallback some clients use for CSV
]);
const CSV_EXTENSIONS = [".csv"];

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"];

function extensionOf(filename) {
  const lower = String(filename || "").toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot);
}

function makeFilter(allowedMimeTypes, allowedExtensions, label) {
  return (_req, file, cb) => {
    const ext = extensionOf(file.originalname);
    const mimeOk = allowedMimeTypes.has(String(file.mimetype || "").toLowerCase());
    const extOk = allowedExtensions.includes(ext);
    if (mimeOk && extOk) return cb(null, true);
    // Some browsers send a generic/incorrect MIME type for CSV; accept if the
    // extension is right and MIME isn't actively contradicting it (e.g. not
    // an image/executable claiming to be a .csv).
    if (extOk && (file.mimetype === "" || file.mimetype == null)) {
      return cb(null, true);
    }
    cb(
      new AppError(
        `Unsupported file type for ${label} upload: ${file.mimetype || "unknown"} (${ext || "no extension"})`,
        400,
        "UNSUPPORTED_FILE_TYPE",
      ),
    );
  };
}

export const csvFileFilter = makeFilter(CSV_MIME_TYPES, CSV_EXTENSIONS, "CSV");
export const imageFileFilter = makeFilter(IMAGE_MIME_TYPES, IMAGE_EXTENSIONS, "image");
