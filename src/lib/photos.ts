// Photo capture helpers: compress to ≤ 300 KB (E6-4, NFR-4) and tag with GPS and time (E3-3).
import type { GPS, Photo, PhotoKind } from '../data/types';
import { isOnline, uid } from '../data/store';

const MAX_BYTES = 300 * 1024;

const dataUrlBytes = (dataUrl: string) => Math.ceil(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

/** Downscale and re-encode as JPEG until it is at most 300 KB. */
export async function compressImage(file: File): Promise<{ dataUrl: string; bytes: number }> {
  const img = await loadImage(file);
  let maxSide = 1600;
  let quality = 0.8;
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const bytes = dataUrlBytes(dataUrl);
    if (bytes <= MAX_BYTES) return { dataUrl, bytes };
    if (quality > 0.5) quality -= 0.1;
    else maxSide = Math.round(maxSide * 0.75);
  }
  throw new Error('Could not compress photo under 300 KB');
}

/** One-off location read. Only called at check-in/out and when taking photos — no background tracking (NFR-7). */
export function getLocation(timeoutMs = 8000): Promise<GPS | undefined> {
  if (!('geolocation' in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(5), lng: +p.coords.longitude.toFixed(5), accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(undefined),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** Compress a picked/captured file into a Photo record tagged with time and GPS. */
export async function makePhoto(file: File, kind: PhotoKind): Promise<Photo> {
  const [{ dataUrl, bytes }, gps] = await Promise.all([compressImage(file), getLocation()]);
  return { id: uid('ph_'), kind, dataUrl, bytes, takenAt: new Date().toISOString(), gps, uploaded: isOnline() };
}

export const formatGps = (g?: GPS) => (g ? `${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}` : 'No location');
