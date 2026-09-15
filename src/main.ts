import "./styles.css";
import { analyzeQr } from "./qr/analyze";
import { decodeQrImage, QrDecodeError } from "./qr/zxing-adapter";
import { createViewer, type ViewerController, type ViewerElements } from "./viewer";
import type { DetectedQr, QrAnalysis } from "./qr/types";

/** Dependencies supplied to the upload controller, replaceable by tests. */
export interface AppDependencies {
  /** Browser QR image decoder. */
  readonly decode: (file: File) => Promise<DetectedQr>;
  /** Structural analyzer for decoded symbols. */
  readonly analyze: (detected: DetectedQr) => QrAnalysis;
  /** Viewer used to render successful analyses. */
  readonly viewer: ViewerController;
  /** Object URL creation function. */
  readonly createObjectUrl: (file: File) => string;
  /** Object URL revocation function. */
  readonly revokeObjectUrl: (url: string) => void;
}

/** Elements required by the upload controller. */
export interface AppElements {
  /** File input accepting image uploads. */
  readonly input: HTMLInputElement;
  /** Accessible status and error region. */
  readonly status: HTMLElement;
}

/** Wires upload handling, busy state, error reporting, and stale-result protection. */
export function createApp(elements: AppElements, dependencies: AppDependencies): { dispose: () => void } {
  let request = 0;
  let objectUrl: string | null = null;

  function replaceObjectUrl(file: File): string {
    if (objectUrl !== null) dependencies.revokeObjectUrl(objectUrl);
    objectUrl = dependencies.createObjectUrl(file);
    return objectUrl;
  }

  async function handleFile(file: File, token: number): Promise<void> {
    try {
      const detected = await dependencies.decode(file);
      const analysis = dependencies.analyze(detected);
      if (token !== request) return;
      const sourceUrl = replaceObjectUrl(file);
      dependencies.viewer.show(sourceUrl, analysis);
      elements.status.textContent = "QR Code decoded.";
    } catch (error) {
      if (token !== request) return;
      dependencies.viewer.clear();
      elements.status.textContent = error instanceof QrDecodeError ? error.message : "A QR Code was found, but its data is damaged or unsupported.";
    } finally {
      if (token === request) elements.input.disabled = false;
    }
  }

  function onChange(): void {
    const file = elements.input.files?.[0];
    request += 1;
    elements.input.disabled = true;
    elements.status.textContent = "Decoding image…";
    dependencies.viewer.clear();
    if (file === undefined) {
      elements.status.textContent = "Choose an image file.";
      elements.input.disabled = false;
      return;
    }
    void handleFile(file, request);
  }

  elements.input.addEventListener("change", onChange);
  window.addEventListener("unload", () => {
    if (objectUrl !== null) dependencies.revokeObjectUrl(objectUrl);
  });
  return {
    dispose(): void {
      elements.input.removeEventListener("change", onChange);
      if (objectUrl !== null) dependencies.revokeObjectUrl(objectUrl);
    },
  };
}

function requireElement<T extends HTMLElement>(id: string, type: new (...args: never[]) => T): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

if (document.getElementById("qr-file") !== null) {
  const viewerElements: ViewerElements = {
    results: requireElement("results", HTMLElement),
    image: requireElement("source-image", HTMLImageElement),
    overlayCanvas: requireElement("overlay-canvas", HTMLCanvasElement),
    highlightCanvas: requireElement("highlight-canvas", HTMLCanvasElement),
    summary: requireElement("summary", HTMLElement),
    legend: requireElement("legend", HTMLElement),
    details: requireElement("details", HTMLElement),
    segments: requireElement("segments", HTMLElement),
    payload: requireElement("payload", HTMLElement),
  };

  createApp(
    { input: requireElement("qr-file", HTMLInputElement), status: requireElement("status", HTMLElement) },
    { decode: decodeQrImage, analyze: analyzeQr, viewer: createViewer(viewerElements), createObjectUrl: URL.createObjectURL.bind(URL), revokeObjectUrl: URL.revokeObjectURL.bind(URL) },
  );
}
