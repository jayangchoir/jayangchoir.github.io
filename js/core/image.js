// 사진·그림 줄이기 (올리기 전에 이 기기에서)
// - 긴 변을 maxDim(기본 1600px) 이하로 줄이고 다시 저장한다. 다시 저장하면 사진 속 위치(GPS) 같은 EXIF 정보도 빠진다.
// - PNG·WebP(투명 배경이 있을 수 있음)는 PNG로, 나머지는 JPEG(quality 0.85)로.
// - 결과가 maxBytes(기본 1.5MB)보다 크면 0.8배씩 더 줄인다.
// - GIF(움직이는 그림)·SVG·그림이 아닌 파일은 그대로 둔다.

export const isRaster = type => /^image\/(jpeg|png|webp|heic|heif|bmp|avif)$/i.test(type || '');

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch {}
    try { return await createImageBitmap(blob); } catch {}
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(src, w, h, type, quality) {
  if (typeof OffscreenCanvas === 'function') {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
    g.drawImage(src, 0, 0, w, h);
    return c.convertToBlob({ type, quality });
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.drawImage(src, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('그림을 줄이지 못했어요.'))), type, quality));
}

// → { blob, type, w, h }   (그림이 아니면 w, h 는 0)
export async function prepareImage(blob, { maxDim = 1600, quality = 0.85, maxBytes = 1.5e6 } = {}) {
  if (!isRaster(blob.type)) return { blob, type: blob.type || 'application/octet-stream', w: 0, h: 0 };
  const src = await decode(blob);
  const W = src.width;
  const H = src.height;
  const type = /png|webp/i.test(blob.type) ? 'image/png' : 'image/jpeg';
  let dim = maxDim;
  let out;
  let w;
  let h;
  for (let i = 0; i < 6; i++) {
    const s = Math.min(1, dim / Math.max(W, H));
    w = Math.max(1, Math.round(W * s));
    h = Math.max(1, Math.round(H * s));
    out = await draw(src, w, h, type, quality);
    if (out.size <= maxBytes) break;
    dim = Math.round(Math.max(w, h) * 0.8);
  }
  src.close?.();
  return { blob: out, type, w, h };
}
