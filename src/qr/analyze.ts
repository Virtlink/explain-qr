import { QRCodeDecoderErrorCorrectionLevel, QRCodeVersion } from "@zxing/library";
import { createProjection } from "./projection";
import { parseSegments } from "./segments";
import type { CodewordInfo, DetectedQr, ModuleInfo, ModuleRole, QrAnalysis, SegmentInfo } from "./types";

interface MutableModule {
  role?: ModuleRole;
  instance?: string;
}

interface TraversedBit {
  row: number;
  col: number;
  sampled: boolean;
  unmasked: boolean;
}

const EC_LABELS: Record<string, string> = { L: "Low", M: "Medium", Q: "Quartile", H: "High" };

function maskApplies(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0: return ((row + col) & 1) === 0;
    case 1: return (row & 1) === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return ((Math.floor(row / 2) + Math.floor(col / 3)) & 1) === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return ((((row * col) % 2) + ((row * col) % 3)) & 1) === 0;
    case 7: return ((((row + col) % 2) + ((row * col) % 3)) & 1) === 0;
    default: throw new Error("decode-failed");
  }
}

function createGrid(dimension: number): MutableModule[][] {
  return Array.from({ length: dimension }, () => Array.from({ length: dimension }, () => ({})));
}

function assign(grid: MutableModule[][], row: number, col: number, role: ModuleRole, instance?: string): void {
  if (row < 0 || col < 0 || row >= grid.length || col >= grid.length) return;
  const current = grid[row]![col]!;
  if (current.role !== undefined) return;
  current.role = role;
  current.instance = instance;
}

function assignFinder(grid: MutableModule[][], top: number, left: number, instance: string): void {
  for (let row = top; row < top + 7; row += 1) {
    for (let col = left; col < left + 7; col += 1) assign(grid, row, col, "finder", instance);
  }
  for (let index = -1; index <= 7; index += 1) {
    assign(grid, top - 1, left + index, "separator", instance);
    assign(grid, top + 7, left + index, "separator", instance);
    assign(grid, top + index, left - 1, "separator", instance);
    assign(grid, top + index, left + 7, "separator", instance);
  }
}

function classifyFunctionModules(versionNumber: number, dimension: number): MutableModule[][] {
  const grid = createGrid(dimension);
  assignFinder(grid, 0, 0, "top-left finder");
  assignFinder(grid, 0, dimension - 7, "top-right finder");
  assignFinder(grid, dimension - 7, 0, "bottom-left finder");
  for (let col = 8; col <= dimension - 9; col += 1) assign(grid, 6, col, "timing-horizontal", "row 6");
  for (let row = 8; row <= dimension - 9; row += 1) assign(grid, row, 6, "timing-vertical", "column 6");
  const version = QRCodeVersion.getVersionForNumber(versionNumber);
  for (const centerRow of Array.from(version.getAlignmentPatternCenters())) {
    for (const centerCol of Array.from(version.getAlignmentPatternCenters())) {
      if ((centerRow <= 8 && centerCol <= 8) || (centerRow <= 8 && centerCol >= dimension - 9) || (centerRow >= dimension - 9 && centerCol <= 8)) continue;
      for (let row = centerRow - 2; row <= centerRow + 2; row += 1) {
        for (let col = centerCol - 2; col <= centerCol + 2; col += 1) assign(grid, row, col, "alignment", `center (${centerCol}, ${centerRow})`);
      }
    }
  }
  const formatPositions: Array<[number, number]> = [];
  for (let index = 0; index < 6; index += 1) formatPositions.push([8, index], [index, 8]);
  formatPositions.push([8, 7], [8, 8], [7, 8]);
  for (let row = dimension - 7; row < dimension; row += 1) formatPositions.push([row, 8]);
  for (let col = dimension - 8; col < dimension; col += 1) formatPositions.push([8, col]);
  for (const [row, col] of formatPositions) assign(grid, row, col, "format-information", "format copy");
  assign(grid, dimension - 8, 8, "dark-module", "fixed dark module");
  if (versionNumber >= 7) {
    for (let index = 0; index < 6; index += 1) {
      for (let offset = dimension - 11; offset <= dimension - 9; offset += 1) {
        assign(grid, index, offset, "version-information", "top-right version copy");
        assign(grid, offset, index, "version-information", "bottom-left version copy");
      }
    }
  }
  return grid;
}

function traversePayload(detected: DetectedQr, functionGrid: MutableModule[][]): TraversedBit[] {
  const bits: TraversedBit[] = [];
  let readingUp = true;
  for (let rightCol = detected.dimension - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol -= 1;
    for (let count = 0; count < detected.dimension; count += 1) {
      const row = readingUp ? detected.dimension - 1 - count : count;
      for (let offset = 0; offset < 2; offset += 1) {
        const col = rightCol - offset;
        if (functionGrid[row]![col]!.role === undefined) {
          const sampled = detected.bits.get(col, row);
          bits.push({ row, col, sampled, unmasked: maskApplies(detected.mask, row, col) ? !sampled : sampled });
        }
      }
    }
    readingUp = !readingUp;
  }
  return bits;
}

function codewordOwnership(detected: DetectedQr): { codewords: CodewordInfo[]; dataCount: number; ecCount: number; blockCount: number } {
  const version = QRCodeVersion.getVersionForNumber(detected.version);
  const level = QRCodeDecoderErrorCorrectionLevel.fromString(detected.errorCorrectionLevel);
  const ecBlocks = version.getECBlocksForLevel(level);
  const blocks: Array<{ data: number; total: number }> = [];
  for (const ecBlock of ecBlocks.getECBlocks()) {
    for (let index = 0; index < ecBlock.getCount(); index += 1) {
      blocks.push({ data: ecBlock.getDataCodewords(), total: ecBlock.getDataCodewords() + ecBlocks.getECCodewordsPerBlock() });
    }
  }
  const rawOwners = new Array<CodewordInfo>(version.getTotalCodewords());
  let rawIndex = 0;
  let dataOffset = 0;
  const shorterTotal = blocks[0]!.total;
  let longerStart = blocks.length - 1;
  while (longerStart >= 0 && blocks[longerStart]!.total !== shorterTotal) longerStart -= 1;
  longerStart += 1;
  const shorterData = shorterTotal - ecBlocks.getECCodewordsPerBlock();
  for (let byte = 0; byte < shorterData; byte += 1) {
    for (let block = 0; block < blocks.length; block += 1) {
      const rawByte = detected.rawCodewords[rawIndex]!;
      const correctedByte = detected.correctedDataBytes[dataOffset]!;
      rawOwners[rawIndex] = { interleavedIndex: rawIndex, block, withinBlockIndex: byte, kind: "data", rawByte, correctedByte, corrected: rawByte !== correctedByte, dataByteOffset: dataOffset };
      rawIndex += 1;
      dataOffset += 1;
    }
  }
  for (let block = longerStart; block < blocks.length; block += 1) {
    const rawByte = detected.rawCodewords[rawIndex]!;
    const correctedByte = detected.correctedDataBytes[dataOffset]!;
    rawOwners[rawIndex] = { interleavedIndex: rawIndex, block, withinBlockIndex: shorterData, kind: "data", rawByte, correctedByte, corrected: rawByte !== correctedByte, dataByteOffset: dataOffset };
    rawIndex += 1;
    dataOffset += 1;
  }
  for (let byte = shorterData; byte < shorterTotal; byte += 1) {
    for (let block = 0; block < blocks.length; block += 1) {
      const withinBlockIndex = block < longerStart ? byte : byte + 1;
      rawOwners[rawIndex] = { interleavedIndex: rawIndex, block, withinBlockIndex, kind: "error-correction", rawByte: detected.rawCodewords[rawIndex]!, corrected: false };
      rawIndex += 1;
    }
  }
  if (rawIndex !== detected.rawCodewords.length || rawOwners.some((owner) => owner === undefined)) throw new Error("decode-failed");
  return { codewords: rawOwners, dataCount: dataOffset, ecCount: detected.rawCodewords.length - dataOffset, blockCount: blocks.length };
}

function segmentForBit(segments: readonly SegmentInfo[], dataByteOffset: number | undefined, bitIndex: number): SegmentInfo | undefined {
  if (dataByteOffset === undefined) return undefined;
  const bitOffset = dataByteOffset * 8 + bitIndex;
  return segments.find((segment) => bitOffset >= segment.startBit && bitOffset < segment.endBit);
}

function payloadText(segments: readonly SegmentInfo[]): string {
  let text = "";
  for (const segment of segments) {
    if (["numeric-group", "alphanumeric-group", "byte-data", "kanji-character", "hanzi-character"].includes(segment.kind)) text += segment.value;
  }
  return text;
}

function inputModes(segments: readonly SegmentInfo[]): string[] {
  const modes: string[] = [];
  const contentKinds = new Set(["numeric-group", "alphanumeric-group", "byte-data", "kanji-character", "hanzi-character"]);
  for (const segment of segments) {
    if (contentKinds.has(segment.kind) && !modes.includes(segment.mode)) modes.push(segment.mode);
  }
  return modes;
}

/**
 * Builds a complete immutable QR module model from ZXing detection/decoding output.
 * Invariant failures throw decode-failed so the UI never renders partial ownership data.
 */
export function analyzeQr(detected: DetectedQr): QrAnalysis {
  if (detected.dimension !== detected.bits.getWidth() || detected.dimension !== detected.bits.getHeight()) throw new Error("decode-failed");
  if (detected.dimension !== 17 + detected.version * 4) throw new Error("decode-failed");
  const version = QRCodeVersion.getVersionForNumber(detected.version);
  const functionGrid = classifyFunctionModules(detected.version, detected.dimension);
  const traversal = traversePayload(detected, functionGrid);
  const expectedBits = version.getTotalCodewords() * 8;
  if (traversal.length < expectedBits) throw new Error("decode-failed");
  const ownership = codewordOwnership(detected);
  const segments = parseSegments(detected.correctedDataBytes, version);
  if (payloadText(segments) !== detected.text) throw new Error("decode-failed");
  const modules: ModuleInfo[][] = Array.from({ length: detected.dimension }, (_, row) => Array.from({ length: detected.dimension }, (_, col) => {
    const fixed = functionGrid[row]![col]!;
    if (fixed.role === undefined) return null as unknown as ModuleInfo;
    return { row, col, sampled: detected.bits.get(col, row), role: fixed.role, instance: fixed.instance };
  }));
  let remainderBitCount = 0;
  for (let index = 0; index < traversal.length; index += 1) {
    const bit = traversal[index]!;
    if (index >= expectedBits) {
      remainderBitCount += 1;
      modules[bit.row]![bit.col] = { row: bit.row, col: bit.col, sampled: bit.sampled, unmasked: bit.unmasked, role: "remainder", instance: "Remainder / unused" };
      continue;
    }
    const codewordIndex = Math.floor(index / 8);
    const bitIndex = index & 7;
    const codeword = ownership.codewords[codewordIndex]!;
    const role: ModuleRole = codeword.kind === "data" ? "data" : "error-correction";
    modules[bit.row]![bit.col] = { row: bit.row, col: bit.col, sampled: bit.sampled, unmasked: bit.unmasked, role, codewordIndex, bitIndex, codeword, segment: segmentForBit(segments, codeword.dataByteOffset, bitIndex) };
  }
  let assigned = 0;
  for (const row of modules) {
    for (const module of row) {
      if (module === null) throw new Error("decode-failed");
      assigned += 1;
    }
  }
  if (assigned !== detected.dimension * detected.dimension) throw new Error("decode-failed");
  return Object.freeze({
    version: detected.version,
    dimension: detected.dimension,
    mask: detected.mask,
    errorCorrectionLevel: detected.errorCorrectionLevel,
    text: detected.text,
    inputModes: inputModes(segments),
    segments,
    modules,
    codewords: ownership.codewords,
    points: detected.points,
    mirrored: detected.mirrored,
    workingWidth: detected.workingWidth,
    workingHeight: detected.workingHeight,
    dataCodewordCount: ownership.dataCount,
    ecCodewordCount: ownership.ecCount,
    blockCount: ownership.blockCount,
    remainderBitCount,
    projection: createProjection(detected.points, detected.dimension, detected.mirrored),
  });
}

/** Formats an error-correction level for summary cards. */
export function errorCorrectionLabel(level: string): string {
  return `${EC_LABELS[level] ?? level} (${level})`;
}
