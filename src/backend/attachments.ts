import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { CommandError } from "./errors.js";
import { readCanonicalRoot, readRegularFile, readRootDescriptor } from "./canonicalReader.js";
import { syncDirectory, withRootWriterLock, writeDurableFile } from "./localDomain.js";
import { readPending } from "./pending.js";
import { assertArgs } from "./protocol.js";
import type { Request } from "./protocol.js";
import { synchronizeAuthority, withCacheTransaction } from "./queryCache.js";
import { findReceipt, requireWriteContext, storeReceipt } from "./receipts.js";
import { attachmentName } from "./taskModel.js";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const formats = {
  "image/png": {
    extension: "png",
    signature: (bytes: Buffer) => startsWith(bytes, 0, "\x89PNG\r\n\x1a\n"),
  },
  "image/jpeg": {
    extension: "jpg",
    signature: (bytes: Buffer) => startsWith(bytes, 0, "\xff\xd8\xff"),
  },
  "image/gif": {
    extension: "gif",
    signature: (bytes: Buffer) => startsWith(bytes, 0, "GIF87a") || startsWith(bytes, 0, "GIF89a"),
  },
  "image/webp": {
    extension: "webp",
    signature: (bytes: Buffer) => startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP"),
  },
} as const;
type AttachmentType = keyof typeof formats;

function startsWith(bytes: Buffer, offset: number, signature: string): boolean {
  return bytes.subarray(offset, offset + signature.length).equals(Buffer.from(signature, "latin1"));
}

function typeOfName(name: string): AttachmentType {
  const extension = name.slice(name.lastIndexOf(".") + 1);
  return (Object.keys(formats) as AttachmentType[]).find(
    (type) => formats[type].extension === extension,
  )!;
}

/** The image format the bytes start with, for callers that only have a file. */
export function detectAttachmentType(bytes: Buffer): AttachmentType | undefined {
  return (Object.keys(formats) as AttachmentType[]).find((type) => formats[type].signature(bytes));
}

export function attachmentPath(rootPath: string, name: string): string {
  return path.join(rootPath, "attachments", name);
}

function parseAttachmentWrite(args: Record<string, unknown>): {
  type: AttachmentType;
  bytes: Buffer;
} {
  assertArgs(args, ["type", "data"]);
  if (typeof args.type !== "string" || !Object.hasOwn(formats, args.type))
    throw new CommandError("INVALID_ARGUMENT", "attachments must be PNG, JPEG, WebP or GIF");
  if (
    typeof args.data !== "string" ||
    args.data.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(args.data)
  )
    throw new CommandError("INVALID_ARGUMENT", "attachment data must be base64");
  const type = args.type as AttachmentType;
  const bytes = Buffer.from(args.data, "base64");
  if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES)
    throw new CommandError("INVALID_ARGUMENT", "attachments must be at most 10 MiB");
  if (!formats[type].signature(bytes))
    throw new CommandError("INVALID_ARGUMENT", `attachment data is not ${type}`);
  return { type, bytes };
}

/** `YYYY-MM-DD-HHMMSS-xxxxxxxx.ext` in UTC, so name order is time order. */
function newAttachmentName(type: AttachmentType, at: string): string {
  const time = `${at.slice(0, 10)}-${at.slice(11, 19).replaceAll(":", "")}`;
  return `${time}-${randomBytes(4).toString("hex")}.${formats[type].extension}`;
}

export function executeAttachmentWrite(request: Request, rootPath: string, cachePath: string) {
  const root = readRootDescriptor(rootPath);
  return withRootWriterLock(root, () =>
    withCacheTransaction(cachePath, root, (database) => {
      let authority = synchronizeAuthority(database, root);
      requireWriteContext(request, authority);
      const input = parseAttachmentWrite(request.args);
      const receipt = findReceipt(database, request);
      if (receipt) return { writeContext: authority.writeContext, result: receipt };
      if (readPending(root))
        throw new CommandError("RECOVERY_PENDING", "root has an unfinished intent");
      const snapshot = readCanonicalRoot(root.rootPath);
      authority = synchronizeAuthority(database, root, snapshot);
      requireWriteContext(request, authority);
      const name = newAttachmentName(input.type, new Date().toISOString());
      if (request.readOnly || request.dryRun)
        return {
          writeContext: authority.writeContext,
          result: { name, changed: true, readOnly: request.readOnly, dryRun: request.dryRun },
        };
      const directory = path.join(root.rootPath, "attachments");
      if (!existsSync(directory)) {
        mkdirSync(directory);
        syncDirectory(root.rootPath);
      }
      // Syncthing skips `.syncthing.*.tmp`, so a partly written image never syncs.
      const stage = path.join(directory, `.syncthing.taskdb-attach-${randomUUID()}.tmp`);
      writeDurableFile(stage, input.bytes);
      const target = attachmentPath(root.rootPath, name);
      if (existsSync(target))
        throw new CommandError("STALE_SCOPE", "attachment name already exists");
      renameSync(stage, target);
      syncDirectory(directory);
      const result = { name, changed: true };
      storeReceipt(database, request, result);
      return { writeContext: authority.writeContext, result };
    }),
  );
}

export function readAttachment(
  rootPath: string,
  args: Record<string, unknown>,
): { type: AttachmentType; data: string } {
  assertArgs(args, ["name"]);
  if (typeof args.name !== "string" || !attachmentName.test(args.name))
    throw new CommandError("INVALID_ARGUMENT", "invalid attachment name");
  const filePath = attachmentPath(rootPath, args.name);
  if (!lstatSync(filePath, { throwIfNoEntry: false }))
    throw new CommandError("ATTACHMENT_NOT_FOUND", "attachment is not in this folder");
  const bytes = readRegularFile(filePath);
  const type = typeOfName(args.name);
  if (bytes.length > MAX_ATTACHMENT_BYTES || !formats[type].signature(bytes))
    throw new CommandError("INVALID_STORAGE", `attachment is not a valid ${type} file`);
  return { type, data: bytes.toString("base64") };
}

/** Names a write adds must already be stored; names a task already lists may still be syncing. */
export function requireAddedAttachments(
  rootPath: string,
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
): void {
  for (const name of after ?? []) {
    if (before?.includes(name)) continue;
    if (!lstatSync(attachmentPath(rootPath, name), { throwIfNoEntry: false })?.isFile())
      throw new CommandError("INVALID_ARGUMENT", `attachment ${name} is not in this folder`);
  }
}
