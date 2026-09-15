import {
  BinaryBitmap,
  ChecksumException,
  FormatException,
  HybridBinarizer,
  NotFoundException,
  type BitMatrix,
} from "@zxing/library";
import { HTMLCanvasElementLuminanceSource } from "@zxing/library/esm/browser/HTMLCanvasElementLuminanceSource";
import Detector from "@zxing/library/esm/core/qrcode/detector/Detector";
import Decoder from "@zxing/library/esm/core/qrcode/decoder/Decoder";
import BitMatrixParser from "@zxing/library/esm/core/qrcode/decoder/BitMatrixParser";
import QRCodeDecoderMetaData from "@zxing/library/esm/core/qrcode/decoder/QRCodeDecoderMetaData";
import { plainPoints, type DetectedQr, type ErrorCorrectionLevelLetter } from "./types";

/** Decode error categories rendered as stable user-facing messages. */
export type QrDecodeErrorCode = "invalid-file" | "invalid-image" | "not-found" | "decode-failed";

const MESSAGES: Record<QrDecodeErrorCode, string> = {
  "invalid-file": "Choose an image file.",
  "invalid-image": "This file could not be read as an image.",
  "not-found": "No standard QR Code was found in this image.",
  "decode-failed": "A QR Code was found, but its data is damaged or unsupported.",
};

/** Error thrown when a file cannot be converted into a complete QR analysis input. */
export class QrDecodeError extends Error {
  /** Stable category used by the controller and tests. */
  readonly code: QrDecodeErrorCode;

  /** Creates a decode error with the required accessible message. */
  constructor(code: QrDecodeErrorCode) {
    super(MESSAGES[code]);
    this.name = "QrDecodeError";
    this.code = code;
  }
}

function cloneTransposed(bits: BitMatrix): BitMatrix {
  const clone = bits.clone();
  for (let col = 0; col < clone.getWidth(); col += 1) {
    for (let row = col + 1; row < clone.getHeight(); row += 1) {
      if (clone.get(col, row) !== clone.get(row, col)) {
        clone.flip(col, row);
        clone.flip(row, col);
      }
    }
  }
  return clone;
}

function parseSampledBits(bits: BitMatrix): { version: number; dimension: number; mask: number; level: ErrorCorrectionLevelLetter; rawCodewords: Uint8Array } {
  const parser = new BitMatrixParser(bits.clone());
  const version = parser.readVersion();
  const format = parser.readFormatInformation();
  const dimension = version.getDimensionForVersion();
  const rawCodewords = parser.readCodewords();
  return {
    version: version.getVersionNumber(),
    dimension,
    mask: format.getDataMask(),
    level: format.getErrorCorrectionLevel().toString() as ErrorCorrectionLevelLetter,
    rawCodewords,
  };
}

/**
 * Decodes an already-sampled QR module matrix into the same analysis input shape as image decoding.
 * This is used by focused tests and generated fixtures; callers provide logical QR coordinates.
 */
export function decodeSampledQrMatrix(bits: BitMatrix, points?: DetectedQr["points"]): DetectedQr {
  const decoderResult = new Decoder().decodeBitMatrix(bits.clone());
  const metadata = decoderResult.getOther();
  const mirrored = metadata instanceof QRCodeDecoderMetaData && metadata.isMirrored();
  const logicalBits = mirrored ? cloneTransposed(bits) : bits.clone();
  const parsed = parseSampledBits(logicalBits);
  return {
    text: decoderResult.getText(),
    rawCodewords: parsed.rawCodewords,
    correctedDataBytes: decoderResult.getRawBytes(),
    bits: logicalBits,
    detectorBits: bits.clone(),
    version: parsed.version,
    dimension: parsed.dimension,
    mask: parsed.mask,
    errorCorrectionLevel: parsed.level,
    points: points ?? [
      { x: 3.5, y: parsed.dimension - 3.5 },
      { x: 3.5, y: 3.5 },
      { x: parsed.dimension - 3.5, y: 3.5 },
      { x: parsed.dimension - 3.5, y: parsed.dimension - 3.5 },
    ],
    mirrored,
    workingWidth: parsed.dimension,
    workingHeight: parsed.dimension,
  };
}

async function drawFileToCanvas(file: File): Promise<{ canvas: HTMLCanvasElement; width: number; height: number; bitmap: ImageBitmap }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new QrDecodeError("invalid-image");
  }
  const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    bitmap.close();
    throw new QrDecodeError("invalid-image");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return { canvas, width, height, bitmap };
}

/**
 * Decodes one standard QR Code Model 2 image file into ZXing-derived structural inputs.
 * Empty selections and non-image files are rejected before QR detection starts.
 */
export async function decodeQrImage(file: File): Promise<DetectedQr> {
  if (file.size === 0 || !file.type.startsWith("image/")) {
    throw new QrDecodeError("invalid-file");
  }
  const rendered = await drawFileToCanvas(file);
  try {
    const luminance = new HTMLCanvasElementLuminanceSource(rendered.canvas);
    const binary = new BinaryBitmap(new HybridBinarizer(luminance));
    const detector = new Detector(binary.getBlackMatrix());
    const detected = detector.detect(new Map());
    const detectorBits = detected.getBits();
    const decoderResult = new Decoder().decodeBitMatrix(detectorBits.clone());
    const metadata = decoderResult.getOther();
    const mirrored = metadata instanceof QRCodeDecoderMetaData && metadata.isMirrored();
    const logicalBits = mirrored ? cloneTransposed(detectorBits) : detectorBits.clone();
    const parsed = parseSampledBits(logicalBits);
    return {
      text: decoderResult.getText(),
      rawCodewords: parsed.rawCodewords,
      correctedDataBytes: decoderResult.getRawBytes(),
      bits: logicalBits,
      detectorBits: detectorBits.clone(),
      version: parsed.version,
      dimension: parsed.dimension,
      mask: parsed.mask,
      errorCorrectionLevel: parsed.level,
      points: plainPoints(detected.getPoints()),
      mirrored,
      workingWidth: rendered.width,
      workingHeight: rendered.height,
    };
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw new QrDecodeError("not-found");
    }
    if (error instanceof FormatException || error instanceof ChecksumException) {
      throw new QrDecodeError("decode-failed");
    }
    if (error instanceof QrDecodeError) {
      throw error;
    }
    throw error;
  } finally {
    rendered.bitmap.close();
  }
}
