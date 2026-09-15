import { describe, expect, it } from "vitest";
import { QRCodeVersion, ZXingStringEncoding } from "@zxing/library";
import { parseSegments } from "./segments";

class Bits {
  values: number[] = [];
  write(value: number, count: number): void {
    for (let index = count - 1; index >= 0; index -= 1) this.values.push((value >> index) & 1);
  }
  bytes(): Uint8Array {
    while (this.values.length % 8 !== 0) this.values.push(0);
    const bytes = new Uint8Array(this.values.length / 8);
    for (let index = 0; index < this.values.length; index += 1) bytes[index >> 3]! |= this.values[index]! << (7 - (index & 7));
    return bytes;
  }
}

function version(number: number = 1) {
  return QRCodeVersion.getVersionForNumber(number);
}

function byteStream(text: string, eci?: number): Uint8Array {
  const bits = new Bits();
  if (eci !== undefined) {
    bits.write(0b0111, 4);
    bits.write(eci, 8);
  }
  const encoded = ZXingStringEncoding.encode(text, "UTF-8");
  bits.write(0b0100, 4);
  bits.write(encoded.length, 8);
  for (const byte of encoded) bits.write(byte, 8);
  bits.write(0, 4);
  while (bits.values.length % 8 !== 0) bits.write(0, 1);
  bits.write(0xec, 8);
  bits.write(0x11, 8);
  return bits.bytes();
}

describe("parseSegments", () => {
  it("parses numeric groups with exact spans", () => {
    // Arrange
    const bits = new Bits();
    bits.write(0b0001, 4);
    bits.write(7, 10);
    bits.write(867, 10);
    bits.write(530, 10);
    bits.write(9, 4);
    bits.write(0, 4);

    // Act
    const segments = parseSegments(bits.bytes(), version());

    // Assert
    expect(segments.filter((segment) => segment.kind === "numeric-group").map((segment) => segment.value).join("")).toBe("8675309");
    expect(segments.find((segment) => segment.value === "867")?.startBit).toBe(14);
  });

  it("parses alphanumeric HELLO WORLD", () => {
    // Arrange
    const bits = new Bits();
    const text = "HELLO WORLD";
    bits.write(0b0010, 4);
    bits.write(text.length, 9);
    for (let index = 0; index + 1 < text.length; index += 2) bits.write("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:".indexOf(text[index]!) * 45 + "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:".indexOf(text[index + 1]!), 11);
    bits.write("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:".indexOf(text.at(-1)!), 6);
    bits.write(0, 4);

    // Act
    const segments = parseSegments(bits.bytes(), version());

    // Assert
    expect(segments.filter((segment) => segment.kind === "alphanumeric-group").map((segment) => segment.value).join("")).toBe(text);
  });

  it("keeps URL-shaped byte data as parsed text", () => {
    // Arrange
    const bytes = byteStream("https://example.test/a?b=1");

    // Act
    const segments = parseSegments(bytes, version(3));

    // Assert
    expect(segments.find((segment) => segment.kind === "byte-data")?.value).toBe("https://example.test/a?b=1");
    expect(segments.some((segment) => segment.kind === "pad-byte" && segment.value === "0xec")).toBe(true);
  });

  it("parses UTF-8 ECI byte data", () => {
    // Arrange
    const bytes = byteStream("café", 26);

    // Act
    const segments = parseSegments(bytes, version());

    // Assert
    expect(segments.find((segment) => segment.kind === "eci")?.value).toBe("UTF8");
    expect(segments.find((segment) => segment.kind === "byte-data")?.value).toBe("café");
  });

  it("parses Shift-JIS Kanji/Kana", () => {
    // Arrange
    const char = "漢";
    const encoded = new Uint8Array([0x8a, 0xbf]);
    const assembled = (encoded[0]! << 8) | encoded[1]!;
    const subtracted = assembled - 0x8140;
    const bits = new Bits();
    bits.write(0b1000, 4);
    bits.write(1, 8);
    bits.write((subtracted >> 8) * 0xc0 + (subtracted & 0xff), 13);
    bits.write(0, 4);

    // Act
    const segments = parseSegments(bits.bytes(), version());

    // Assert
    expect(segments.find((segment) => segment.kind === "kanji-character")?.value).toBe(char);
  });

  it("rejects malformed numeric lengths", () => {
    // Arrange
    const bits = new Bits();
    bits.write(0b0001, 4);
    bits.write(2, 10);
    bits.write(127, 7);

    // Act
    const act = () => parseSegments(bits.bytes(), version());

    // Assert
    expect(act).toThrow("decode-failed");
  });
});
