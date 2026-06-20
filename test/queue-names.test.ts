import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * BullMQ rejects queue names containing ":". This guard fails the build
 * if anyone reintroduces colons into a BullMQ queue constant. (Redis pub/sub
 * channels and other keys can still use ":" — only BullMQ is strict.)
 */

const FORBIDDEN = [":"];
const QUEUE_FILES = ["src/polling/scheduler.ts", "src/workers/license-expiry.ts"];

describe("BullMQ queue names", () => {
  for (const file of QUEUE_FILES) {
    it(`${file} has no ":" in BullMQ queue constants`, () => {
      const src = readFileSync(file, "utf8");
      // Look for `new Queue(NAME` or `new Worker(NAME` — that's what BullMQ receives.
      const calls = [...src.matchAll(/new (Queue|Worker)\(\s*([A-Z_][A-Z0-9_]*|\"[^\"]+\")/g)];
      expect(calls.length).toBeGreaterThan(0);
      for (const m of calls) {
        const arg = m[2] ?? "";
        for (const ch of FORBIDDEN) {
          expect(arg, `queue name "${arg}" contains forbidden char "${ch}"`).not.toContain(ch);
        }
      }
    });
  }
});
