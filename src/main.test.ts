// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./main";
import { QrDecodeError } from "./qr/zxing-adapter";
import type { DetectedQr, QrAnalysis } from "./qr/types";
import type { ViewerController } from "./viewer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setFiles(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
}

function fixture() {
  document.body.innerHTML = `<input id="file" type="file"><p id="status"></p>`;
  const input = document.getElementById("file") as HTMLInputElement;
  const status = document.getElementById("status")!;
  const viewer: ViewerController = { show: vi.fn(), clear: vi.fn() };
  return { input, status, viewer };
}

describe("createApp", () => {
  it("shows busy and success states around a resolved decode", async () => {
    // Arrange
    const dom = fixture();
    const done = deferred<DetectedQr>();
    const app = createApp(dom, { decode: () => done.promise, analyze: () => ({ text: "ok" }) as QrAnalysis, viewer: dom.viewer, createObjectUrl: () => "blob:ok", revokeObjectUrl: vi.fn() });
    setFiles(dom.input, new File(["x"], "qr.png", { type: "image/png" }));

    // Act
    dom.input.dispatchEvent(new Event("change"));
    const busy = { disabled: dom.input.disabled, status: dom.status.textContent };
    done.resolve({} as DetectedQr);
    await done.promise;
    await Promise.resolve();

    // Assert
    expect(busy).toEqual({ disabled: true, status: "Decoding image…" });
    expect(dom.status.textContent).toBe("QR Code decoded.");
    expect(dom.input.disabled).toBe(false);
    expect(dom.viewer.show).toHaveBeenCalledOnce();
    app.dispose();
  });

  it("renders decode errors and clears stale viewer state", async () => {
    // Arrange
    const dom = fixture();
    const done = deferred<DetectedQr>();
    createApp(dom, { decode: () => done.promise, analyze: () => ({}) as QrAnalysis, viewer: dom.viewer, createObjectUrl: () => "blob:bad", revokeObjectUrl: vi.fn() });
    setFiles(dom.input, new File(["not image"], "bad.txt", { type: "text/plain" }));

    // Act
    dom.input.dispatchEvent(new Event("change"));
    done.reject(new QrDecodeError("invalid-file"));
    await done.promise.catch(() => undefined);
    await Promise.resolve();

    // Assert
    expect(dom.status.textContent).toBe("Choose an image file.");
    expect(dom.input.disabled).toBe(false);
    expect(dom.viewer.clear).toHaveBeenCalled();
  });

  it("prevents a late older result from replacing the latest file", async () => {
    // Arrange
    const dom = fixture();
    const older = deferred<DetectedQr>();
    const newer = deferred<DetectedQr>();
    const decode = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    createApp(dom, { decode, analyze: () => ({ text: "ok" }) as QrAnalysis, viewer: dom.viewer, createObjectUrl: (file) => `blob:${file.name}`, revokeObjectUrl: vi.fn() });

    // Act
    setFiles(dom.input, new File(["a"], "old.png", { type: "image/png" }));
    dom.input.dispatchEvent(new Event("change"));
    setFiles(dom.input, new File(["b"], "new.png", { type: "image/png" }));
    dom.input.dispatchEvent(new Event("change"));
    newer.resolve({} as DetectedQr);
    await newer.promise;
    await Promise.resolve();
    older.resolve({} as DetectedQr);
    await older.promise;
    await Promise.resolve();

    // Assert
    expect(dom.viewer.show).toHaveBeenCalledTimes(1);
    expect(dom.viewer.show).toHaveBeenCalledWith("blob:new.png", expect.anything());
  });
});
