export function canCompress(): boolean {
  const compressionStream: unknown = Reflect.get(globalThis, 'CompressionStream');
  return compressionStream !== undefined;
}

export function canDecompress(): boolean {
  const decompressionStream: unknown = Reflect.get(globalThis, 'DecompressionStream');
  return decompressionStream !== undefined;
}

/** 依檔頭 1F 8B 判斷，不看副檔名（設計決策 5.4 節）。 */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
