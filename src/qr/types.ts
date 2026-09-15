import type { BitMatrix, ResultPoint } from "@zxing/library";

/** Supported QR Code error-correction level letter. */
export type ErrorCorrectionLevelLetter = "L" | "M" | "Q" | "H";

/** Coordinates of a detected finder or alignment point in the working image. */
export interface Point {
  /** Horizontal coordinate in working-image pixels. */
  readonly x: number;
  /** Vertical coordinate in working-image pixels. */
  readonly y: number;
}

/** Raw QR symbol data produced by the ZXing adapter before structural analysis. */
export interface DetectedQr {
  /** Decoded payload text supplied by ZXing after error correction. */
  readonly text: string;
  /** Interleaved raw codewords as sampled from the symbol before RS correction. */
  readonly rawCodewords: Uint8Array;
  /** Corrected data codewords concatenated in stream order. */
  readonly correctedDataBytes: Uint8Array;
  /** Sampled logical QR matrix, transposed into logical coordinates for mirrored symbols. */
  readonly bits: BitMatrix;
  /** Sampled matrix in detector orientation for projection and display. */
  readonly detectorBits: BitMatrix;
  /** QR version number in the inclusive range 1 through 40. */
  readonly version: number;
  /** Module dimension, equal to 17 + 4 × version. */
  readonly dimension: number;
  /** QR data mask pattern number in the inclusive range 0 through 7. */
  readonly mask: number;
  /** Error-correction level encoded by the symbol format information. */
  readonly errorCorrectionLevel: ErrorCorrectionLevelLetter;
  /** Ordered detector points: bottom-left, top-left, top-right, and optional alignment. */
  readonly points: readonly Point[];
  /** True when ZXing decoded the symbol through its mirrored fallback. */
  readonly mirrored: boolean;
  /** Width of the downscaled working image used for detection. */
  readonly workingWidth: number;
  /** Height of the downscaled working image used for detection. */
  readonly workingHeight: number;
}

/** Structural role assigned to a QR module. */
export type ModuleRole =
  | "finder"
  | "separator"
  | "timing-horizontal"
  | "timing-vertical"
  | "alignment"
  | "format-information"
  | "version-information"
  | "dark-module"
  | "data"
  | "error-correction"
  | "remainder";

/** Reed–Solomon ownership for one full QR codeword. */
export interface CodewordInfo {
  /** Interleaved raw codeword index from the QR placement traversal. */
  readonly interleavedIndex: number;
  /** Reed–Solomon block number, zero-based in ZXing/DataBlock order. */
  readonly block: number;
  /** Byte index inside its Reed–Solomon block. */
  readonly withinBlockIndex: number;
  /** True for payload/data bytes, false for EC bytes. */
  readonly kind: "data" | "error-correction";
  /** Raw byte value before Reed–Solomon correction. */
  readonly rawByte: number;
  /** Corrected data byte value when kind is data. */
  readonly correctedByte?: number;
  /** True when Reed–Solomon changed this data byte. */
  readonly corrected: boolean;
  /** Offset among data bytes after deinterleaving, only for data bytes. */
  readonly dataByteOffset?: number;
}

/** Parsed user-facing QR data-stream segment or control field. */
export interface SegmentInfo {
  /** UI label for the segment or control field. */
  readonly mode: string;
  /** Machine-readable segment kind. */
  readonly kind: string;
  /** Inclusive start bit in the corrected data byte stream. */
  readonly startBit: number;
  /** Exclusive end bit in the corrected data byte stream. */
  readonly endBit: number;
  /** Decoded text or explanatory value for this span. */
  readonly value: string;
}

/** Complete per-module details used by rendering and inspection. */
export interface ModuleInfo {
  /** Logical module row, zero-based from the top. */
  readonly row: number;
  /** Logical module column, zero-based from the left. */
  readonly col: number;
  /** Sampled module color before unmasking, where true is black. */
  readonly sampled: boolean;
  /** Unmasked logical value for payload modules. */
  readonly unmasked?: boolean;
  /** Structural or payload role. */
  readonly role: ModuleRole;
  /** Named fixed-pattern instance, when applicable. */
  readonly instance?: string;
  /** Interleaved raw codeword index for payload modules. */
  readonly codewordIndex?: number;
  /** Bit index within a byte, zero for most-significant bit. */
  readonly bitIndex?: number;
  /** Reed–Solomon codeword ownership for complete codewords. */
  readonly codeword?: CodewordInfo;
  /** Parsed stream segment owning a corrected data bit. */
  readonly segment?: SegmentInfo;
}

/** Mirror-aware projective geometry for drawing and hit-testing modules. */
export interface Projection {
  /** Projects a logical module corner or center to working-image coordinates. */
  readonly project: (col: number, row: number) => Point;
  /** Converts working-image coordinates to a logical module cell or null when outside. */
  readonly hitTest: (x: number, y: number) => { row: number; col: number } | null;
  /** Projects the four corners of a module as an 8-number polygon. */
  readonly modulePolygon: (row: number, col: number) => Float32Array;
}

/** Immutable analysis model consumed by the viewer. */
export interface QrAnalysis {
  /** QR version number. */
  readonly version: number;
  /** QR module dimension. */
  readonly dimension: number;
  /** Data mask number. */
  readonly mask: number;
  /** Error-correction level letter. */
  readonly errorCorrectionLevel: ErrorCorrectionLevelLetter;
  /** Decoded payload text. */
  readonly text: string;
  /** Distinct input modes in encounter order. */
  readonly inputModes: readonly string[];
  /** Reed–Solomon/data-stream segment details. */
  readonly segments: readonly SegmentInfo[];
  /** Module details by row then column. */
  readonly modules: readonly (readonly ModuleInfo[])[];
  /** Flat codeword ownership list in interleaved index order. */
  readonly codewords: readonly CodewordInfo[];
  /** Detector points in working-image coordinates. */
  readonly points: readonly Point[];
  /** True when decoded as a mirrored symbol. */
  readonly mirrored: boolean;
  /** Working-image width in pixels. */
  readonly workingWidth: number;
  /** Working-image height in pixels. */
  readonly workingHeight: number;
  /** Count of data codewords across all RS blocks. */
  readonly dataCodewordCount: number;
  /** Count of error-correction codewords across all RS blocks. */
  readonly ecCodewordCount: number;
  /** Count of RS blocks. */
  readonly blockCount: number;
  /** Count of remainder/unused bits in the symbol placement area. */
  readonly remainderBitCount: number;
  /** Projection shared by drawing and hit-testing. */
  readonly projection: Projection;
}

/** Converts ZXing result points into plain serializable coordinates. */
export function plainPoints(points: readonly ResultPoint[]): readonly Point[] {
  return points.map((point) => ({ x: point.getX(), y: point.getY() }));
}
