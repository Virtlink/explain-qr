// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeQr } from "./qr/analyze";
import { encodeDetected } from "./qr/test-utils";
import { createViewer, type ViewerElements } from "./viewer";

interface MockContext {
  calls: string[];
  beginPath: () => void;
  moveTo: () => void;
  lineTo: () => void;
  closePath: () => void;
  fill: () => void;
  stroke: () => void;
  clearRect: () => void;
  setLineDash: () => void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

function context(): MockContext {
  const calls: string[] = [];
  return {
    calls,
    beginPath: () => calls.push("beginPath"),
    moveTo: () => calls.push("moveTo"),
    lineTo: () => calls.push("lineTo"),
    closePath: () => calls.push("closePath"),
    fill: () => calls.push("fill"),
    stroke: () => calls.push("stroke"),
    clearRect: () => calls.push("clearRect"),
    setLineDash: () => calls.push("setLineDash"),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
  };
}

function elements(): ViewerElements & { overlayContext: MockContext; highlightContext: MockContext } {
  document.body.innerHTML = `<section id="results" class="hidden"><img id="image"><canvas id="overlay"></canvas><canvas id="highlight"></canvas><div id="summary"></div><div id="legend"></div><dl id="details"></dl><ol id="segments"></ol><pre id="payload"></pre></section>`;
  const overlayContext = context();
  const highlightContext = context();
  const overlayCanvas = document.getElementById("overlay") as HTMLCanvasElement;
  const highlightCanvas = document.getElementById("highlight") as HTMLCanvasElement;
  vi.spyOn(overlayCanvas, "getContext").mockReturnValue(overlayContext as unknown as CanvasRenderingContext2D);
  vi.spyOn(highlightCanvas, "getContext").mockReturnValue(highlightContext as unknown as CanvasRenderingContext2D);
  vi.spyOn(highlightCanvas, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 21, height: 21, right: 21, bottom: 21, x: 0, y: 0, toJSON: () => ({}) });
  return {
    results: document.getElementById("results")!,
    image: document.getElementById("image") as HTMLImageElement,
    overlayCanvas,
    highlightCanvas,
    summary: document.getElementById("summary")!,
    legend: document.getElementById("legend")!,
    details: document.getElementById("details")!,
    segments: document.getElementById("segments")!,
    payload: document.getElementById("payload")!,
    overlayContext,
    highlightContext,
  };
}

describe("createViewer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders summary, segments, and URL-shaped payload as text only", () => {
    // Arrange
    const dom = elements();
    const viewer = createViewer(dom);
    const analysis = analyzeQr(encodeDetected("https://example.test/a?b=1", "Q", 7));

    // Act
    viewer.show("blob:test", analysis);

    // Assert
    expect(dom.summary.textContent).toContain("Version 7");
    expect(dom.summary.textContent).toContain("Quartile (Q)");
    expect(dom.segments.textContent).toContain("Byte / binary");
    expect(dom.payload.textContent).toBe("https://example.test/a?b=1");
    expect(dom.results.querySelectorAll("a")).toHaveLength(0);
  });

  it("legend toggles redraw only the requested layer state", () => {
    // Arrange
    const dom = elements();
    const viewer = createViewer(dom);
    viewer.show("blob:test", analyzeQr(encodeDetected("8675309", "L", 1)));
    const before = dom.overlayContext.calls.length;
    const dataToggle = Array.from(dom.legend.querySelectorAll("label")).find((label) => label.textContent?.includes("Data"))!.querySelector("input")!;

    // Act
    dataToggle.checked = false;
    dataToggle.dispatchEvent(new Event("change", { bubbles: true }));

    // Assert
    expect(dom.overlayContext.calls.length).toBeGreaterThan(before);
    expect(dataToggle.checked).toBe(false);
  });

  it("hover, tap, and arrows update observable details", () => {
    // Arrange
    const dom = elements();
    const viewer = createViewer(dom);
    viewer.show("blob:test", analyzeQr(encodeDetected("8675309", "L", 1)));

    // Act
    dom.highlightCanvas.dispatchEvent(new MouseEvent("pointermove", { clientX: 3, clientY: 3, bubbles: true }));
    const hoverText = dom.details.textContent ?? "";
    dom.highlightCanvas.dispatchEvent(new MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true }));
    dom.highlightCanvas.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    // Assert
    expect(hoverText).toContain("finder");
    expect(dom.details.textContent).toContain("Column");
  });

  it("clear removes stale UI state", () => {
    // Arrange
    const dom = elements();
    const viewer = createViewer(dom);
    viewer.show("blob:test", analyzeQr(encodeDetected("8675309", "L", 1)));

    // Act
    viewer.clear();

    // Assert
    expect(dom.results.classList.contains("hidden")).toBe(true);
    expect(dom.summary.textContent).toBe("");
    expect(dom.payload.textContent).toBe("");
    expect(dom.image.hasAttribute("src")).toBe(false);
  });
});
