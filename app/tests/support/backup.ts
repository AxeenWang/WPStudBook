/** 以 DecompressionStream 解開 gzip，取出文字 */
export async function gunzipText(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}
