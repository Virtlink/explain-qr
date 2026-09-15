import { describe, expect, it } from "vitest";
import { analyzeQr } from "./analyze";
import { decodeSampledQrMatrix } from "./zxing-adapter";
import { encodeDetected } from "./test-utils";

const LEVELS = ["L", "M", "Q", "H"] as const;

describe("analyzeQr", () => {
  it("assigns one role and block ownership for every version and EC level", () => {
    // Arrange
    const cases = LEVELS.flatMap((level) => Array.from({ length: 40 }, (_, index) => ({ level, version: index + 1 })));

    // Act
    const analyses = cases.map(({ level, version }) => analyzeQr(encodeDetected("8675309", level, version)));

    // Assert
    for (const analysis of analyses) {
      expect(analysis.modules).toHaveLength(analysis.dimension);
      expect(analysis.modules.flat()).toHaveLength(analysis.dimension * analysis.dimension);
      expect(analysis.modules.flat().every((module) => module.role.length > 0)).toBe(true);
      expect(analysis.codewords).toHaveLength(analysis.dataCodewordCount + analysis.ecCodewordCount);
      expect(analysis.modules.flat().filter((module) => module.codeword !== undefined)).toHaveLength(analysis.codewords.length * 8);
      expect(analysis.remainderBitCount).toBe(analysis.modules.flat().filter((module) => module.role === "remainder").length);
      expect(analysis.blockCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("splits version-specific fixed patterns", () => {
    // Arrange
    const versionOne = encodeDetected("8675309", "L", 1);
    const versionTwo = encodeDetected("8675309", "L", 2);
    const versionSeven = encodeDetected("8675309", "Q", 7);

    // Act
    const one = analyzeQr(versionOne);
    const two = analyzeQr(versionTwo);
    const seven = analyzeQr(versionSeven);

    // Assert
    expect(one.modules.flat().some((module) => module.role === "alignment")).toBe(false);
    expect(one.modules.flat().some((module) => module.role === "version-information")).toBe(false);
    expect(two.modules.flat().some((module) => module.role === "alignment")).toBe(true);
    expect(seven.modules.flat().some((module) => module.role === "version-information")).toBe(true);
  });

  it("marks a corrected data module after one flipped data bit", () => {
    // Arrange
    const original = encodeDetected("HELLO WORLD", "H", 2);
    const baseline = analyzeQr(original);
    const target = baseline.modules.flat().find((module) => module.role === "data" && module.codeword !== undefined);
    expect(target).toBeDefined();
    const damagedBits = original.bits.clone();
    damagedBits.flip(target!.col, target!.row);

    // Act
    const damaged = analyzeQr(decodeSampledQrMatrix(damagedBits));

    // Assert
    expect(damaged.text).toBe("HELLO WORLD");
    expect(damaged.modules.flat().some((module) => module.codeword?.corrected === true)).toBe(true);
  });
});
