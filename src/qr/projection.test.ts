import { describe, expect, it } from "vitest";
import { createProjection } from "./projection";
import type { Point } from "./types";

function expectRoundTrip(points: readonly Point[], mirrored: boolean): void {
  const projection = createProjection(points, 21, mirrored);
  for (const [row, col] of [[0, 0], [10, 10], [20, 20], [5, 17]]) {
    const point = projection.project(col + 0.5, row + 0.5);
    expect(projection.hitTest(point.x, point.y)).toEqual({ row, col });
    expect(projection.modulePolygon(row, col)).toHaveLength(8);
  }
}

describe("createProjection", () => {
  it("round trips axis-aligned module centers", () => {
    // Arrange
    const points = [{ x: 3.5, y: 17.5 }, { x: 3.5, y: 3.5 }, { x: 17.5, y: 3.5 }, { x: 17.5, y: 17.5 }];

    // Act / Assert
    expectRoundTrip(points, false);
  });

  it("round trips skewed module centers", () => {
    // Arrange
    const points = [{ x: 2, y: 24 }, { x: 5, y: 4 }, { x: 27, y: 7 }, { x: 24, y: 26 }];

    // Act / Assert
    expectRoundTrip(points, false);
  });

  it("round trips mirrored module centers", () => {
    // Arrange
    const points = [{ x: 3.5, y: 17.5 }, { x: 3.5, y: 3.5 }, { x: 17.5, y: 3.5 }, { x: 17.5, y: 17.5 }];

    // Act / Assert
    expectRoundTrip(points, true);
  });

  it("rejects image points outside the symbol", () => {
    // Arrange
    const projection = createProjection([{ x: 3.5, y: 17.5 }, { x: 3.5, y: 3.5 }, { x: 17.5, y: 3.5 }], 21, false);

    // Act
    const hit = projection.hitTest(-50, -50);

    // Assert
    expect(hit).toBeNull();
  });
});
