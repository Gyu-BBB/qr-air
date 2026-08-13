import test from "node:test";
import assert from "node:assert/strict";

globalThis.btoa ??= (value) => Buffer.from(value, "binary").toString("base64");
globalThis.atob ??= (value) => Buffer.from(value, "base64").toString("binary");

const { assembleFrames, base64ToBytes, createFrame, parseFrame } = await import("../src/protocol.js");

test("QR 프레임을 인코딩하고 다시 읽는다", () => {
  const source = new TextEncoder().encode("카메라로 보내는 데이터");
  const raw = createFrame({ id: "abc", total: 1, size: source.length, name: "한글.txt", type: "text/plain", hash: "hash" }, 0, source);
  const frame = parseFrame(raw);
  assert.equal(frame.n, "한글.txt");
  assert.deepEqual(base64ToBytes(frame.d), source);
});

test("순서가 뒤섞인 조각을 원래 파일로 조립한다", () => {
  const chunks = new Map([[1, new Uint8Array([3, 4])], [0, new Uint8Array([1, 2])]]);
  assert.deepEqual(assembleFrames(chunks, 2, 4), new Uint8Array([1, 2, 3, 4]));
});

test("다른 QR과 잘못된 프레임은 거부한다", () => {
  assert.equal(parseFrame("https://example.com"), null);
  assert.equal(parseFrame('{"p":"QRA1","id":"x","i":2,"t":2,"d":""}'), null);
});
