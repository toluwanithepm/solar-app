// Barcode reading for serial numbers (E5-4).
// Uses the phone's built-in reader when it has one (most Android Chrome), otherwise ZXing compiled to WebAssembly,
// bundled with the app (not loaded from a CDN) so it also works with no signal once the app has been opened online.
import { BarcodeDetector as ZXingDetector, setZXingModuleOverrides } from 'barcode-detector/ponyfill';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

type NativeDetectorClass = {
  new (opts?: { formats?: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

const FORMATS = ['code_128', 'code_39', 'qr_code', 'ean_13', 'data_matrix'];

setZXingModuleOverrides({
  locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? new URL(wasmUrl, location.href).href : prefix + path),
});

/** A detector that works on this phone, or null if barcode reading can't run here at all. */
export async function createDetector(): Promise<Detector | null> {
  const Native = (window as unknown as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (Native) {
    try {
      const supported = (await Native.getSupportedFormats?.()) ?? [];
      const usable = FORMATS.filter((f) => supported.includes(f));
      // Some phones expose the API but support nothing (no Google Play services): fall through to ZXing
      if (usable.includes('code_128')) return new Native({ formats: usable });
    } catch {
      // fall through
    }
  }
  if (typeof WebAssembly === 'undefined') return null;
  try {
    return new ZXingDetector({ formats: FORMATS as never }) as unknown as Detector;
  } catch {
    return null;
  }
}

/** Ask the service worker to keep the barcode reader, so scanning works offline (technicians only: it is ~1 MB). */
export function keepScannerOffline() {
  navigator.serviceWorker?.ready
    .then((reg) => reg.active?.postMessage({ type: 'cache-urls', urls: [new URL(wasmUrl, location.href).href] }))
    .catch(() => undefined);
}
