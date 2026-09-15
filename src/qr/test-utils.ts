import { BitMatrix, EncodeHintType, QRCodeDecoderErrorCorrectionLevel, QRCodeEncoder } from "@zxing/library";
import { decodeSampledQrMatrix } from "./zxing-adapter";
import type { DetectedQr, ErrorCorrectionLevelLetter } from "./types";

/** Generates a sampled QR matrix from ZXing's encoder for deterministic tests. */
export function encodeDetected(text: string, level: ErrorCorrectionLevelLetter = "L", version?: number): DetectedQr {
  const hints = new Map<EncodeHintType, unknown>();
  if (version !== undefined) hints.set(EncodeHintType.QR_VERSION, version);
  const qr = QRCodeEncoder.encode(text, QRCodeDecoderErrorCorrectionLevel.fromString(level), hints);
  const matrix = qr.getMatrix();
  const bits = new BitMatrix(matrix.getWidth(), matrix.getHeight());
  for (let row = 0; row < matrix.getHeight(); row += 1) {
    for (let col = 0; col < matrix.getWidth(); col += 1) {
      if (matrix.get(col, row) === 1) bits.set(col, row);
    }
  }
  return decodeSampledQrMatrix(bits);
}
