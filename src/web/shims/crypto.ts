import { sha256 } from "@noble/hashes/sha2.js";
import { Buffer } from "./buffer";

export const randomUUID = (): string => globalThis.crypto.randomUUID();

export const randomBytes = (size: number): Buffer =>
  Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)));

/** The backend only hashes with SHA-256, synchronously, which Web Crypto can't do. */
export function createHash(algorithm: string) {
  if (algorithm !== "sha256") throw new Error(`Unsupported hash: ${algorithm}`);
  const hash = sha256.create();
  return {
    update(data: string | Uint8Array) {
      hash.update(typeof data === "string" ? new TextEncoder().encode(data) : data);
      return this;
    },
    digest(encoding?: BufferEncoding) {
      const bytes = Buffer.from(hash.digest());
      return encoding ? bytes.toString(encoding) : bytes;
    },
  };
}
