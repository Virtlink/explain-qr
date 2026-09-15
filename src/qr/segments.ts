import { CharacterSetECI, DecodeHintType, QRCodeMode, QRCodeVersion, StringUtils, ZXingStringEncoding } from "@zxing/library";
import type { SegmentInfo } from "./types";

const ALPHANUMERIC = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

class BitCursor {
  readonly bytes: Uint8Array;
  offset = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  available(): number {
    return this.bytes.length * 8 - this.offset;
  }

  read(count: number): number {
    if (count < 0 || this.available() < count) {
      throw new Error("decode-failed");
    }
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      const absolute = this.offset + index;
      const byte = this.bytes[absolute >> 3]!;
      value = (value << 1) | ((byte >> (7 - (absolute & 7))) & 1);
    }
    this.offset += count;
    return value;
  }
}

function add(segments: SegmentInfo[], kind: string, mode: string, startBit: number, endBit: number, value: string): void {
  segments.push({ kind, mode, startBit, endBit, value });
}

function decodeBytes(bytes: Uint8Array, eci: CharacterSetECI | null): string {
  if (eci !== null) {
    return ZXingStringEncoding.decode(bytes, eci.name);
  }
  const guessed = StringUtils.guessEncoding(bytes, new Map([[DecodeHintType.CHARACTER_SET, undefined]]));
  return ZXingStringEncoding.decode(bytes, guessed);
}

function parseEci(cursor: BitCursor): number {
  const first = cursor.read(8);
  if ((first & 0x80) === 0) {
    return first & 0x7f;
  }
  if ((first & 0xc0) === 0x80) {
    return ((first & 0x3f) << 8) | cursor.read(8);
  }
  if ((first & 0xe0) === 0xc0) {
    return ((first & 0x1f) << 16) | cursor.read(16);
  }
  throw new Error("decode-failed");
}

function applyFnc1(value: string, fnc1: boolean): string {
  if (!fnc1) {
    return value;
  }
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== "%") {
      output += char;
    } else if (value[index + 1] === "%") {
      output += "%";
      index += 1;
    } else {
      output += String.fromCharCode(29);
    }
  }
  return output;
}

function decodeNumeric(cursor: BitCursor, count: number, segments: SegmentInfo[]): string {
  let value = "";
  let remaining = count;
  while (remaining >= 3) {
    const start = cursor.offset;
    const group = cursor.read(10);
    const text = group.toString().padStart(3, "0");
    add(segments, "numeric-group", "Numeric", start, cursor.offset, text);
    value += text;
    remaining -= 3;
  }
  if (remaining === 2) {
    const start = cursor.offset;
    const group = cursor.read(7);
    if (group >= 100) throw new Error("decode-failed");
    const text = group.toString().padStart(2, "0");
    add(segments, "numeric-group", "Numeric", start, cursor.offset, text);
    value += text;
  } else if (remaining === 1) {
    const start = cursor.offset;
    const group = cursor.read(4);
    if (group >= 10) throw new Error("decode-failed");
    const text = group.toString();
    add(segments, "numeric-group", "Numeric", start, cursor.offset, text);
    value += text;
  }
  return value;
}

function decodeAlphanumeric(cursor: BitCursor, count: number, segments: SegmentInfo[], fnc1: boolean): string {
  let value = "";
  let remaining = count;
  while (remaining >= 2) {
    const start = cursor.offset;
    const group = cursor.read(11);
    const text = ALPHANUMERIC[Math.floor(group / 45)]! + ALPHANUMERIC[group % 45]!;
    add(segments, "alphanumeric-group", "Alphanumeric", start, cursor.offset, applyFnc1(text, fnc1));
    value += text;
    remaining -= 2;
  }
  if (remaining === 1) {
    const start = cursor.offset;
    const group = cursor.read(6);
    if (group >= ALPHANUMERIC.length) throw new Error("decode-failed");
    const text = ALPHANUMERIC[group]!;
    add(segments, "alphanumeric-group", "Alphanumeric", start, cursor.offset, applyFnc1(text, fnc1));
    value += text;
  }
  return applyFnc1(value, fnc1);
}

function sjisChar(subtracted: number): string {
  const assembled = ((Math.floor(subtracted / 0xc0) << 8) | (subtracted % 0xc0)) + (subtracted < 0x1f00 ? 0x8140 : 0xc140);
  return ZXingStringEncoding.decode(new Uint8Array([assembled >> 8, assembled & 0xff]), "Shift_JIS");
}

function gbChar(subtracted: number): string {
  const assembled = ((Math.floor(subtracted / 0x60) << 8) | (subtracted % 0x60)) + 0xa1a1;
  return ZXingStringEncoding.decode(new Uint8Array([assembled >> 8, assembled & 0xff]), "GB2312");
}

/**
 * Parses corrected QR data bytes into user-facing mode/control spans with absolute bit offsets.
 * Malformed streams throw a decode-failed error instead of returning contradictory metadata.
 */
export function parseSegments(bytes: Uint8Array, version: QRCodeVersion): SegmentInfo[] {
  const cursor = new BitCursor(bytes);
  const segments: SegmentInfo[] = [];
  let currentEci: CharacterSetECI | null = null;
  let fnc1 = false;
  while (cursor.available() >= 4) {
    const modeStart = cursor.offset;
    const modeBits = cursor.read(4);
    if (modeBits === 0) {
      add(segments, "terminator", "Terminator", modeStart, cursor.offset, "End of data");
      break;
    }
    const mode = QRCodeMode.forBits(modeBits);
    add(segments, "mode-indicator", mode.toString(), modeStart, cursor.offset, mode.toString());
    if (mode.equals(QRCodeMode.ECI)) {
      const start = cursor.offset;
      const value = parseEci(cursor);
      currentEci = CharacterSetECI.getCharacterSetECIByValue(value);
      add(segments, "eci", "ECI", start, cursor.offset, currentEci?.name ?? String(value));
      continue;
    }
    if (mode.equals(QRCodeMode.FNC1_FIRST_POSITION) || mode.equals(QRCodeMode.FNC1_SECOND_POSITION)) {
      fnc1 = true;
      add(segments, "fnc1", mode.toString(), modeStart, cursor.offset, "FNC1 enabled");
      continue;
    }
    if (mode.equals(QRCodeMode.STRUCTURED_APPEND)) {
      const start = cursor.offset;
      const sequence = cursor.read(8);
      const parity = cursor.read(8);
      add(segments, "structured-append", "Structured append", start, cursor.offset, `sequence ${sequence}, parity ${parity}`);
      continue;
    }
    const countStart = cursor.offset;
    let count: number;
    if (mode.equals(QRCodeMode.HANZI)) {
      const subset = cursor.read(4);
      count = cursor.read(mode.getCharacterCountBits(version));
      add(segments, "character-count", "Hanzi", countStart, cursor.offset, `subset ${subset}, ${count} characters`);
    } else {
      count = cursor.read(mode.getCharacterCountBits(version));
      add(segments, "character-count", mode.toString(), countStart, cursor.offset, `${count} characters`);
    }
    if (mode.equals(QRCodeMode.NUMERIC)) {
      decodeNumeric(cursor, count, segments);
    } else if (mode.equals(QRCodeMode.ALPHANUMERIC)) {
      decodeAlphanumeric(cursor, count, segments, fnc1);
    } else if (mode.equals(QRCodeMode.BYTE)) {
      const start = cursor.offset;
      const data = new Uint8Array(count);
      for (let index = 0; index < count; index += 1) data[index] = cursor.read(8);
      add(segments, "byte-data", "Byte / binary", start, cursor.offset, applyFnc1(decodeBytes(data, currentEci), fnc1));
    } else if (mode.equals(QRCodeMode.KANJI)) {
      for (let index = 0; index < count; index += 1) {
        const start = cursor.offset;
        add(segments, "kanji-character", "Kanji/Kana", start, cursor.offset + 13, sjisChar(cursor.read(13)));
      }
    } else if (mode.equals(QRCodeMode.HANZI)) {
      for (let index = 0; index < count; index += 1) {
        const start = cursor.offset;
        add(segments, "hanzi-character", "Hanzi", start, cursor.offset + 13, gbChar(cursor.read(13)));
      }
    } else {
      throw new Error("decode-failed");
    }
  }
  if (cursor.offset % 8 !== 0) {
    const start = cursor.offset;
    const zeros = Math.min(cursor.available(), 8 - (cursor.offset % 8));
    const value = cursor.read(zeros);
    if (value !== 0) throw new Error("decode-failed");
    add(segments, "byte-alignment", "Byte alignment", start, cursor.offset, "Zero padding");
  }
  let padIndex = 0;
  while (cursor.available() >= 8) {
    const start = cursor.offset;
    const byte = cursor.read(8);
    const expected = padIndex % 2 === 0 ? 0xec : 0x11;
    if (byte !== expected && byte !== 0) throw new Error("decode-failed");
    add(segments, byte === 0 ? "unused-data" : "pad-byte", "Pad byte", start, cursor.offset, `0x${byte.toString(16).padStart(2, "0")}`);
    padIndex += 1;
  }
  return segments;
}
