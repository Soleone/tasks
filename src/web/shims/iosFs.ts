import { Buffer } from "./buffer";

/**
 * node:fs for the backend in the iOS app's worker: each call is one blocking request to the
 * shell (src-tauri/src/ios_files.rs), which works on real files in the app's Documents folder.
 * Only the calls the backend makes are here.
 */

type Path = string | number;
type StatOptions = { bigint?: boolean; throwIfNoEntry?: boolean };
type Found = Record<"kind" | "dev" | "ino" | "size" | "mtimeNs" | "ctimeNs", string>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function failure(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

function request(
  call: string,
  path: string,
  options: Record<string, unknown> = {},
  bytes: Uint8Array = new Uint8Array(),
): Uint8Array {
  const line = encoder.encode(`${JSON.stringify({ call, path, ...options })}\n`);
  const body = new Uint8Array(line.length + bytes.length);
  body.set(line);
  body.set(bytes, line.length);
  const http = new XMLHttpRequest();
  http.open("POST", "tasksfs://localhost/", false);
  http.responseType = "arraybuffer";
  http.send(body);
  const answer = new Uint8Array(http.response as ArrayBuffer);
  if (http.status === 200) return answer;
  if (http.status !== 400) throw failure("EIO", `the app's file access failed (${http.status})`);
  const { code, message } = JSON.parse(decoder.decode(answer)) as { code: string; message: string };
  throw failure(code, `${message}, ${call} '${path}'`);
}

function json<T>(call: string, path: string, options?: Record<string, unknown>): T {
  return JSON.parse(decoder.decode(request(call, path, options))) as T;
}

/** Descriptors are only remembered paths: every call names its file to the shell again. */
const descriptors = new Map<number, { path: string; read: number }>();
let nextDescriptor = 3;

function pathOf(file: Path): string {
  if (typeof file === "string") return file;
  const open = descriptors.get(file);
  if (!open) throw failure("EBADF", "bad file descriptor");
  return open.path;
}

function stats(found: Found, bigint: boolean | undefined) {
  const number = (text: string) => (bigint ? BigInt(text) : Number(text));
  return {
    dev: number(found.dev),
    ino: number(found.ino),
    size: number(found.size),
    mtimeNs: number(found.mtimeNs),
    ctimeNs: number(found.ctimeNs),
    isFile: () => found.kind === "file",
    isDirectory: () => found.kind === "directory",
    isSymbolicLink: () => found.kind === "link",
  };
}

function stat(path: string, follow: boolean, options: StatOptions = {}) {
  try {
    return stats(json<Found>("stat", path, { follow }), options.bigint);
  } catch (error) {
    if (options.throwIfNoEntry === false && (error as { code?: string }).code === "ENOENT")
      return undefined;
    throw error;
  }
}

export const constants = { O_RDONLY: 0, O_NOFOLLOW: 0x100 };

export const lstatSync = (path: string, options?: StatOptions) => stat(path, false, options);
export const statSync = (path: string, options?: StatOptions) => stat(path, true, options);
export const fstatSync = (descriptor: number, options?: StatOptions) =>
  stat(pathOf(descriptor), true, options);
export const existsSync = (path: string) => statSync(path, { throwIfNoEntry: false }) !== undefined;
export const readdirSync = (path: string) => json<string[]>("list", path);
export const realpathSync = Object.assign((path: string) => json<string>("realpath", path), {
  native: (path: string) => json<string>("realpath", path),
});

export function openSync(path: string, flags: string | number): number {
  if (flags === "w" || flags === "wx") request("write", path, { exclusive: flags === "wx" });
  else {
    const follow = typeof flags === "string" || (flags & constants.O_NOFOLLOW) === 0;
    if (stat(path, follow)!.isSymbolicLink())
      throw failure("ELOOP", `too many links, open '${path}'`);
  }
  descriptors.set(nextDescriptor, { path, read: 0 });
  return nextDescriptor++;
}

export function closeSync(descriptor: number): void {
  descriptors.delete(descriptor);
}

export function fsyncSync(descriptor: number): void {
  request("sync", pathOf(descriptor));
}

export function readFileSync(file: Path): Buffer;
export function readFileSync(file: Path, encoding: BufferEncoding): string;
export function readFileSync(file: Path, encoding?: BufferEncoding): Buffer | string {
  const bytes = Buffer.from(request("read", pathOf(file)));
  return encoding ? bytes.toString(encoding) : bytes;
}

/** Fills the chunk from where the last read of this descriptor stopped. */
export function readSync(descriptor: number, chunk: Uint8Array): number {
  const open = descriptors.get(descriptor)!;
  const bytes = request("read", open.path).subarray(open.read, open.read + chunk.length);
  chunk.set(bytes);
  open.read += bytes.length;
  return bytes.length;
}

/** A path is replaced whole and flushed; a descriptor, opened empty, is added to. */
export function writeFileSync(file: Path, bytes: Uint8Array): void {
  request(typeof file === "string" ? "write" : "append", pathOf(file), {}, bytes);
}

export function writeSync(descriptor: number, bytes: Uint8Array): number {
  writeFileSync(descriptor, bytes);
  return bytes.length;
}

/** With `recursive`, the first folder it had to create, as Node returns it. */
export function mkdirSync(path: string, options: { recursive?: boolean } = {}): string | undefined {
  if (!options.recursive) {
    request("mkdir", path);
    return undefined;
  }
  const missing: string[] = [];
  for (let folder = path; !existsSync(folder); folder = folder.slice(0, folder.lastIndexOf("/")))
    missing.unshift(folder);
  for (const folder of missing) request("mkdir", folder);
  return missing[0];
}

export function renameSync(from: string, to: string): void {
  request("rename", from, { to });
}

export function unlinkSync(path: string): void {
  request("remove", path);
}

export function rmSync(path: string, options: { force?: boolean } = {}): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if (!options.force || (error as { code?: string }).code !== "ENOENT") throw error;
  }
}
