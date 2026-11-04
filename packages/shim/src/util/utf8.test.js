import { describe, it, expect } from "vitest";
import { utf8ByteLength } from "./utf8.js";

describe("utf8ByteLength", () => {
  it("matches the length TextEncoder produces", () => {
    const samples = [
      "",
      "plain ascii",
      "café",
      "日本語",
      "emoji 😀 pair",
      "lone \ud800 high",
      "lone \udc00 low",
      "trailing high \ud83d",
    ];

    for (const text of samples) {
      expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length);
    }
  });
});
