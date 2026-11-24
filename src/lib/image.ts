/**
 * 画像はメモリ上でのみ扱い、長辺1024pxのJPEGに縮小してbase64化する。
 * 保存はしない(IndexedDB / localStorage / Cache に書かない)。ObjectURLも作らない。
 */
export async function resizeToJpegBase64(file: Blob, maxEdge = 1024): Promise<{ mimeType: 'image/jpeg'; data: string }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('画像の変換に失敗しました'))), 'image/jpeg', 0.85));
    canvas.width = 0; canvas.height = 0; // 参照を切る
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { mimeType: 'image/jpeg', data: btoa(bin) };
  } finally {
    bmp.close();
  }
}
