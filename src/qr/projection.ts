import { PerspectiveTransform } from "@zxing/library";
import type { Point, Projection } from "./types";

function transform(transformer: PerspectiveTransform, x: number, y: number): Point {
  const points = new Float32Array([x, y]);
  transformer.transformPoints(points);
  return { x: points[0]!, y: points[1]! };
}

function logicalPoint(col: number, row: number, mirrored: boolean): [number, number] {
  return mirrored ? [row, col] : [col, row];
}

/**
 * Creates mirror-aware projective mappings between logical QR module coordinates and the working image.
 * Points must be ZXing detector points ordered as bottom-left, top-left, top-right, and optional alignment.
 */
export function createProjection(points: readonly Point[], dimension: number, mirrored: boolean): Projection {
  if (points.length < 3) {
    throw new Error("decode-failed");
  }
  const bottomLeft = points[0]!;
  const topLeft = points[1]!;
  const topRight = points[2]!;
  const bottomRight = points[3] ?? {
    x: topRight.x - topLeft.x + bottomLeft.x,
    y: topRight.y - topLeft.y + bottomLeft.y,
  };
  const min = 3.5;
  const max = dimension - 3.5;
  const forward = PerspectiveTransform.quadrilateralToQuadrilateral(
    min,
    min,
    max,
    min,
    max,
    max,
    min,
    max,
    topLeft.x,
    topLeft.y,
    topRight.x,
    topRight.y,
    bottomRight.x,
    bottomRight.y,
    bottomLeft.x,
    bottomLeft.y,
  );
  const inverse = PerspectiveTransform.quadrilateralToQuadrilateral(
    topLeft.x,
    topLeft.y,
    topRight.x,
    topRight.y,
    bottomRight.x,
    bottomRight.y,
    bottomLeft.x,
    bottomLeft.y,
    min,
    min,
    max,
    min,
    max,
    max,
    min,
    max,
  );
  const reusable = new Float32Array(8);
  return {
    project(col: number, row: number): Point {
      const [x, y] = logicalPoint(col, row, mirrored);
      return transform(forward, x, y);
    },
    hitTest(x: number, y: number): { row: number; col: number } | null {
      const mapped = transform(inverse, x, y);
      const rawCol = mirrored ? mapped.y : mapped.x;
      const rawRow = mirrored ? mapped.x : mapped.y;
      const col = Math.floor(rawCol);
      const row = Math.floor(rawRow);
      if (row < 0 || col < 0 || row >= dimension || col >= dimension) {
        return null;
      }
      return { row, col };
    },
    modulePolygon(row: number, col: number): Float32Array {
      const corners: Array<[number, number]> = [
        logicalPoint(col, row, mirrored),
        logicalPoint(col + 1, row, mirrored),
        logicalPoint(col + 1, row + 1, mirrored),
        logicalPoint(col, row + 1, mirrored),
      ];
      for (let index = 0; index < corners.length; index += 1) {
        const [x, y] = corners[index]!;
        reusable[index * 2] = x;
        reusable[index * 2 + 1] = y;
      }
      forward.transformPoints(reusable);
      return new Float32Array(reusable);
    },
  };
}
