const PROTOCOL = "QRA1";

export function bytesToBase64(bytes) {
  let binary = "";
  const stride = 0x8000;
  for (let i = 0; i < bytes.length; i += stride) {
    binary += String.fromCharCode(...bytes.subarray(i, i + stride));
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function makeSessionId() {
  const value = new Uint8Array(6);
  crypto.getRandomValues(value);
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createFrame(meta, index, bytes) {
  return JSON.stringify({
    p: PROTOCOL,
    id: meta.id,
    i: index,
    t: meta.total,
    s: meta.size,
    n: meta.name,
    m: meta.type,
    h: meta.hash,
    d: bytesToBase64(bytes),
  });
}

export function parseFrame(raw) {
  try {
    const frame = JSON.parse(raw);
    if (
      frame.p !== PROTOCOL ||
      typeof frame.id !== "string" ||
      !Number.isInteger(frame.i) ||
      !Number.isInteger(frame.t) ||
      frame.i < 0 ||
      frame.t < 1 ||
      frame.i >= frame.t ||
      typeof frame.d !== "string"
    ) return null;
    return frame;
  } catch {
    return null;
  }
}

export function assembleFrames(chunks, total, expectedSize) {
  if (chunks.size !== total) throw new Error("아직 받지 못한 조각이 있습니다.");
  const output = new Uint8Array(expectedSize);
  let offset = 0;
  for (let index = 0; index < total; index += 1) {
    const chunk = chunks.get(index);
    if (!chunk) throw new Error(`${index + 1}번 조각이 없습니다.`);
    output.set(chunk, offset);
    offset += chunk.length;
  }
  if (offset !== expectedSize) throw new Error("복원된 파일 크기가 일치하지 않습니다.");
  return output;
}
