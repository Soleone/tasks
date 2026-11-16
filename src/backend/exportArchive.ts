import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";
import { CommandError } from "./errors.js";
import { readRegularFile } from "./canonicalReader.js";
import { homeOfRoot } from "./home.js";
import { syncDirectory } from "./localDomain.js";
import { assertArgs } from "./protocol.js";

const UTF8_NAMES = 0x0800;

function dosTime(at: Date): { time: number; date: number } {
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((at.getFullYear() - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/** Bytes as they were written, read back in pieces so a large export never sits in memory twice. */
function fileHash(filePath: string): string {
  const hash = createHash("sha256");
  const descriptor = openSync(filePath, "r");
  try {
    const chunk = Buffer.alloc(1 << 20);
    for (let read; (read = readSync(descriptor, chunk)) > 0;) hash.update(chunk.subarray(0, read));
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

/**
 * Writes a zip of the entries into the home's `exports/` as `<name>-<date>-<time>.zip`, and
 * returns its path once it reads back exactly as written. Entries are stored uncompressed:
 * images are compressed already.
 */
export function writeExport(
  homePath: string,
  at: string,
  name: string,
  entries: readonly { name: string; read: () => Buffer }[],
): string {
  const directory = path.join(homePath, "exports");
  if (!lstatSync(directory, { throwIfNoEntry: false })) {
    mkdirSync(directory);
    syncDirectory(homePath);
  }
  const target = path.join(
    directory,
    `${name}-${at.slice(0, 10)}-${at.slice(11, 19).replaceAll(":", "")}.zip`,
  );
  if (lstatSync(target, { throwIfNoEntry: false }))
    throw new CommandError("STALE_SCOPE", "an export with this name already exists; try again");
  if (entries.length > 0xffff)
    throw new CommandError("INVALID_ARGUMENT", "too many files for one export");
  const stage = `${target}.partial`;
  const { time, date } = dosTime(new Date(at));
  const hash = createHash("sha256");
  const centralDirectory: Buffer[] = [];
  let offset = 0;
  const descriptor = openSync(stage, "w", 0o600);
  try {
    try {
      const write = (bytes: Buffer) => {
        writeSync(descriptor, bytes);
        hash.update(bytes);
        offset += bytes.length;
      };
      for (const entry of entries) {
        const entryName = Buffer.from(entry.name);
        const data = entry.read();
        if (offset + 30 + entryName.length + data.length > 0xffffffff)
          throw new CommandError("INVALID_ARGUMENT", "an export can hold at most 4 GB");
        const crc = crc32(data);
        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(UTF8_NAMES, 6);
        localHeader.writeUInt16LE(time, 10);
        localHeader.writeUInt16LE(date, 12);
        localHeader.writeUInt32LE(crc, 14);
        localHeader.writeUInt32LE(data.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(entryName.length, 26);
        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(UTF8_NAMES, 8);
        centralHeader.writeUInt16LE(time, 12);
        centralHeader.writeUInt16LE(date, 14);
        centralHeader.writeUInt32LE(crc, 16);
        centralHeader.writeUInt32LE(data.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(entryName.length, 28);
        centralHeader.writeUInt32LE(offset, 42);
        centralDirectory.push(centralHeader, entryName);
        write(localHeader);
        write(entryName);
        write(data);
      }
      const directoryOffset = offset;
      for (const part of centralDirectory) write(part);
      const endRecord = Buffer.alloc(22);
      endRecord.writeUInt32LE(0x06054b50, 0);
      endRecord.writeUInt16LE(entries.length, 8);
      endRecord.writeUInt16LE(entries.length, 10);
      endRecord.writeUInt32LE(offset - directoryOffset, 12);
      endRecord.writeUInt32LE(directoryOffset, 16);
      write(endRecord);
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (fileHash(stage) !== hash.digest("hex"))
      throw new CommandError("INVALID_STORAGE", "the export didn't read back as written");
  } catch (error) {
    // A failed export can be gigabytes; don't leave it in exports/.
    rmSync(stage, { force: true });
    throw error;
  }
  renameSync(stage, target);
  syncDirectory(directory);
  return target;
}

/** Syncthing's own folders and half-received files, which aren't the person's data. */
const SYNC_TOOL_ENTRY = /^(\.st|\.syncthing\.|~syncthing~)/;

/**
 * Zips the sync folder as it stands into the home's `exports/`: every file under `sync/` in the
 * zip, so unpacking it gives the folder back. A download answers the zip itself and keeps no
 * file, for a home that lives in a browser.
 */
export function exportWorkspace(
  rootPath: string,
  args: Record<string, unknown>,
): { files: number } & ({ exportLocation: string } | { name: string; data: string }) {
  assertArgs(args, ["download"]);
  if (args.download !== undefined && typeof args.download !== "boolean")
    throw new CommandError("INVALID_ARGUMENT", "download must be true or false");
  const home = homeOfRoot(rootPath);
  if (!home)
    throw new CommandError("INVALID_ARGUMENT", "export needs a Tasks home, not a bare folder");
  const files: string[] = [];
  const walk = (folder: string) => {
    const entries = readdirSync(path.join(rootPath, folder), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (SYNC_TOOL_ENTRY.test(entry.name)) continue;
      const child = folder ? `${folder}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  walk("");
  const exportLocation = writeExport(
    home,
    new Date().toISOString(),
    "tasks",
    files.map((file) => ({
      name: `sync/${file}`,
      read: () => readRegularFile(path.join(rootPath, file)),
    })),
  );
  if (!args.download) return { exportLocation, files: files.length };
  const data = readRegularFile(exportLocation).toString("base64");
  rmSync(exportLocation);
  return { name: path.basename(exportLocation), data, files: files.length };
}
