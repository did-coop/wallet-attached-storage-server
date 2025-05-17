export function bytesToB64(bytes: Uint8Array) {
  const binString = Array.from(bytes, (byte) =>
    String.fromCodePoint(byte),
  ).join("");
  return btoa(binString);
}

export function bytesFromBase64(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export function bytesToDataUri(bytes: Uint8Array, mediaType:string|undefined=undefined, base64=true) {
  const segments = []
  if (mediaType) segments.push(mediaType)
  if (base64) segments.push('base64')
  const dataText = base64 ? bytesToB64(new Uint8Array(bytes)) : new TextDecoder().decode(bytes)
  const dataUri = `data:${segments.join(';')},${dataText}`
  return dataUri
}
