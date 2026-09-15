import { errorCorrectionLabel } from "./qr/analyze";
import type { ModuleInfo, ModuleRole, QrAnalysis, SegmentInfo } from "./qr/types";

/** DOM elements controlled by the QR viewer. */
export interface ViewerElements {
  /** Results container hidden when no analysis is available. */
  readonly results: HTMLElement;
  /** Source image element. */
  readonly image: HTMLImageElement;
  /** Stable overlay canvas. */
  readonly overlayCanvas: HTMLCanvasElement;
  /** Interactive highlight canvas. */
  readonly highlightCanvas: HTMLCanvasElement;
  /** Summary card container. */
  readonly summary: HTMLElement;
  /** Legend checkbox container. */
  readonly legend: HTMLElement;
  /** Persistent details definition list. */
  readonly details: HTMLElement;
  /** Segment list container. */
  readonly segments: HTMLElement;
  /** Payload preformatted text element. */
  readonly payload: HTMLElement;
}

/** Operations exposed to the upload controller. */
export interface ViewerController {
  /** Shows a decoded QR analysis and resets the selection/filter UI. */
  readonly show: (sourceUrl: string, analysis: QrAnalysis) => void;
  /** Clears all stale visual and textual state. */
  readonly clear: () => void;
}

type Layer = "fixed" | "data" | "error-correction" | "remainder";

const ROLE_LAYER: Record<ModuleRole, Layer> = {
  finder: "fixed",
  separator: "fixed",
  "timing-horizontal": "fixed",
  "timing-vertical": "fixed",
  alignment: "fixed",
  "format-information": "fixed",
  "version-information": "fixed",
  "dark-module": "fixed",
  data: "data",
  "error-correction": "error-correction",
  remainder: "remainder",
};

const ROLE_COLORS: Record<string, string> = {
  finder: "rgba(220,38,38,.46)",
  separator: "rgba(251,146,60,.35)",
  "timing-horizontal": "rgba(37,99,235,.42)",
  "timing-vertical": "rgba(37,99,235,.42)",
  alignment: "rgba(147,51,234,.42)",
  "format-information": "rgba(5,150,105,.42)",
  "version-information": "rgba(13,148,136,.42)",
  "dark-module": "rgba(0,0,0,.55)",
  remainder: "rgba(100,116,139,.45)",
};

function blockColor(block: number, alpha: number): string {
  const hue = (block * 137.508) % 360;
  return `hsla(${hue}, 82%, 48%, ${alpha})`;
}

function clearChildren(element: HTMLElement): void {
  while (element.firstChild !== null) element.firstChild.remove();
}

function appendPair(list: HTMLElement, key: string, value: string): void {
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = key;
  dd.textContent = value;
  list.append(dt, dd);
}

function drawPolygon(context: CanvasRenderingContext2D, points: Float32Array, fill: string, stroke: string, dashed: boolean): void {
  context.beginPath();
  context.moveTo(points[0]!, points[1]!);
  for (let index = 2; index < points.length; index += 2) context.lineTo(points[index]!, points[index + 1]!);
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = stroke;
  context.lineWidth = 0.75;
  context.setLineDash(dashed ? [3, 2] : []);
  context.stroke();
}

function moduleColor(module: ModuleInfo): { fill: string; stroke: string; dashed: boolean } {
  if (module.role === "data" && module.codeword !== undefined) {
    return { fill: blockColor(module.codeword.block, 0.24), stroke: blockColor(module.codeword.block, 0.55), dashed: false };
  }
  if (module.role === "error-correction" && module.codeword !== undefined) {
    return { fill: blockColor(module.codeword.block, 0.1), stroke: blockColor(module.codeword.block, 0.9), dashed: true };
  }
  return { fill: ROLE_COLORS[module.role] ?? "rgba(0,0,0,.2)", stroke: "rgba(15,23,42,.45)", dashed: false };
}

function addSummary(container: HTMLElement, key: string, value: string): void {
  const card = document.createElement("dl");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  card.className = "summary-card";
  dt.textContent = key;
  dd.textContent = value;
  card.append(dt, dd);
  container.append(card);
}

function renderSegments(container: HTMLElement, segments: readonly SegmentInfo[]): void {
  clearChildren(container);
  for (const segment of segments) {
    const item = document.createElement("li");
    item.textContent = `${segment.mode}: ${segment.value} (${segment.startBit}–${segment.endBit})`;
    container.append(item);
  }
}

function detailRows(module: ModuleInfo): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ["Row", String(module.row)],
    ["Column", String(module.col)],
    ["Sampled", module.sampled ? "Black" : "White"],
    ["Role", module.role],
  ];
  if (module.unmasked !== undefined) rows.push(["Unmasked", module.unmasked ? "Black / 1" : "White / 0"]);
  if (module.instance !== undefined) rows.push(["Instance", module.instance]);
  if (module.codewordIndex !== undefined) rows.push(["Codeword", String(module.codewordIndex)], ["Bit", String(module.bitIndex)]);
  if (module.codeword !== undefined) {
    rows.push(["RS block", String(module.codeword.block)], ["Within block", String(module.codeword.withinBlockIndex)], ["Kind", module.codeword.kind], ["Raw byte", `0x${module.codeword.rawByte.toString(16).padStart(2, "0")}`]);
    if (module.codeword.correctedByte !== undefined) rows.push(["Corrected byte", `0x${module.codeword.correctedByte.toString(16).padStart(2, "0")}`], ["Corrected", module.codeword.corrected ? "Yes" : "No"]);
  }
  if (module.segment !== undefined) rows.push(["Segment", module.segment.mode], ["Field", module.segment.kind], ["Value", module.segment.value]);
  return rows;
}

/** Creates a DOM/canvas QR viewer with persistent module inspection. */
export function createViewer(elements: ViewerElements): ViewerController {
  let analysis: QrAnalysis | null = null;
  let active: ModuleInfo | null = null;
  const enabled: Record<Layer, boolean> = { fixed: true, data: true, "error-correction": true, remainder: true };

  function contexts(): { overlay: CanvasRenderingContext2D; highlight: CanvasRenderingContext2D } | null {
    const overlay = elements.overlayCanvas.getContext("2d");
    const highlight = elements.highlightCanvas.getContext("2d");
    return overlay !== null && highlight !== null ? { overlay, highlight } : null;
  }

  function drawOverlay(): void {
    if (analysis === null) return;
    const pair = contexts();
    if (pair === null) return;
    pair.overlay.clearRect(0, 0, elements.overlayCanvas.width, elements.overlayCanvas.height);
    for (const row of analysis.modules) {
      for (const module of row) {
        if (!enabled[ROLE_LAYER[module.role]]) continue;
        const color = moduleColor(module);
        drawPolygon(pair.overlay, analysis.projection.modulePolygon(module.row, module.col), color.fill, color.stroke, color.dashed);
      }
    }
  }

  function sameHighlight(candidate: ModuleInfo): boolean {
    if (active === null) return false;
    if (candidate.role === "data" || candidate.role === "error-correction") return candidate.role === active.role && candidate.codeword?.block === active.codeword?.block;
    if (candidate.role === "remainder") return active.role === "remainder";
    return candidate.role === active.role && candidate.instance === active.instance;
  }

  function drawHighlight(): void {
    const pair = contexts();
    if (analysis === null || pair === null) return;
    pair.highlight.clearRect(0, 0, elements.highlightCanvas.width, elements.highlightCanvas.height);
    if (active === null) return;
    for (const row of analysis.modules) {
      for (const module of row) {
        if (sameHighlight(module)) drawPolygon(pair.highlight, analysis.projection.modulePolygon(module.row, module.col), "rgba(255,255,255,.25)", "rgba(0,0,0,.95)", false);
      }
    }
  }

  function renderDetails(module: ModuleInfo | null): void {
    clearChildren(elements.details);
    if (module === null) {
      appendPair(elements.details, "Selection", "Hover, tap, or use arrow keys on the overlay.");
      return;
    }
    for (const [key, value] of detailRows(module)) appendPair(elements.details, key, value);
  }

  function setActive(row: number, col: number): void {
    if (analysis === null) return;
    const boundedRow = Math.max(0, Math.min(analysis.dimension - 1, row));
    const boundedCol = Math.max(0, Math.min(analysis.dimension - 1, col));
    active = analysis.modules[boundedRow]![boundedCol]!;
    renderDetails(active);
    drawHighlight();
  }

  function pointerModule(event: PointerEvent): ModuleInfo | null {
    if (analysis === null) return null;
    const rect = elements.highlightCanvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * (elements.highlightCanvas.width / rect.width);
    const y = (event.clientY - rect.top) * (elements.highlightCanvas.height / rect.height);
    const hit = analysis.projection.hitTest(x, y);
    return hit === null ? null : analysis.modules[hit.row]![hit.col]!;
  }

  function buildLegend(): void {
    clearChildren(elements.legend);
    const labels: Array<[Layer, string]> = [["fixed", "Fixed patterns"], ["data", "Data modules"], ["error-correction", "Error correction"], ["remainder", "Remainder / unused"]];
    for (const [layer, label] of labels) {
      const wrapper = document.createElement("label");
      const input = document.createElement("input");
      const swatch = document.createElement("span");
      input.type = "checkbox";
      input.checked = enabled[layer];
      swatch.className = "swatch";
      swatch.textContent = layer === "error-correction" ? "⋯" : "";
      input.addEventListener("change", () => {
        enabled[layer] = input.checked;
        drawOverlay();
      });
      wrapper.append(input, swatch, document.createTextNode(label));
      elements.legend.append(wrapper);
    }
  }

  elements.highlightCanvas.addEventListener("pointermove", (event) => {
    const module = pointerModule(event);
    if (module !== null) setActive(module.row, module.col);
  });
  elements.highlightCanvas.addEventListener("click", (event) => {
    const module = pointerModule(event);
    if (module !== null) setActive(module.row, module.col);
  });
  elements.highlightCanvas.addEventListener("keydown", (event) => {
    if (analysis === null || active === null) return;
    const deltas: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const delta = deltas[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    setActive(active.row + delta[0], active.col + delta[1]);
  });

  return {
    show(sourceUrl: string, nextAnalysis: QrAnalysis): void {
      analysis = nextAnalysis;
      active = null;
      Object.assign(enabled, { fixed: true, data: true, "error-correction": true, remainder: true });
      elements.image.src = sourceUrl;
      elements.overlayCanvas.width = nextAnalysis.workingWidth;
      elements.overlayCanvas.height = nextAnalysis.workingHeight;
      elements.highlightCanvas.width = nextAnalysis.workingWidth;
      elements.highlightCanvas.height = nextAnalysis.workingHeight;
      clearChildren(elements.summary);
      addSummary(elements.summary, "Version", `Version ${nextAnalysis.version}`);
      addSummary(elements.summary, "Size", `${nextAnalysis.dimension} × ${nextAnalysis.dimension} modules`);
      addSummary(elements.summary, "Mask", `Mask ${nextAnalysis.mask}`);
      addSummary(elements.summary, "Error correction", errorCorrectionLabel(nextAnalysis.errorCorrectionLevel));
      addSummary(elements.summary, "Input modes", nextAnalysis.inputModes.join(", ") || "None");
      addSummary(elements.summary, "Data codewords", String(nextAnalysis.dataCodewordCount));
      addSummary(elements.summary, "EC codewords", String(nextAnalysis.ecCodewordCount));
      addSummary(elements.summary, "Blocks", String(nextAnalysis.blockCount));
      addSummary(elements.summary, "Remainder bits", String(nextAnalysis.remainderBitCount));
      buildLegend();
      renderSegments(elements.segments, nextAnalysis.segments);
      elements.payload.textContent = nextAnalysis.text;
      elements.results.classList.remove("hidden");
      renderDetails(null);
      drawOverlay();
    },
    clear(): void {
      analysis = null;
      active = null;
      elements.image.removeAttribute("src");
      for (const element of [elements.summary, elements.legend, elements.details, elements.segments, elements.payload]) clearChildren(element);
      contexts()?.overlay.clearRect(0, 0, elements.overlayCanvas.width, elements.overlayCanvas.height);
      contexts()?.highlight.clearRect(0, 0, elements.highlightCanvas.width, elements.highlightCanvas.height);
      elements.results.classList.add("hidden");
    },
  };
}
