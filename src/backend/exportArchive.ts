import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { crc32 } from "node:zlib";
import { CommandError } from "./errors.js";
import { readRegularFile } from "./canonicalReader.js";
import { syncDirectory } from "./localDomain.js";

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
 * Writes a zip of `tasks.json` and the given files under `attachments/` into the home's
 * `exports/`, and returns its path once it reads back exactly as written. Entries are stored
 * uncompressed: images are compressed already.
 */
export function writeExport(
  homePath: string,
  at: string,
  tasksJson: Buffer,
  attachments: readonly { name: string; filePath: string }[],
): string {
  const directory = path.join(homePath, "exports");
  if (!lstatSync(directory, { throwIfNoEntry: false })) {
    mkdirSync(directory);
    syncDirectory(homePath);
  }
  const target = path.join(
    directory,
    `done-tasks-${at.slice(0, 10)}-${at.slice(11, 19).replaceAll(":", "")}.zip`,
  );
  if (lstatSync(target, { throwIfNoEntry: false }))
    throw new CommandError("STALE_SCOPE", "an export with this name already exists; try again");
  const stage = `${target}.partial`;
  const { time, date } = dosTime(new Date(at));
  const hash = createHash("sha256");
  const central: Buffer[] = [];
  let offset = 0;
  const descriptor = openSync(stage, "w", 0o600);
  try {
    try {
      const write = (bytes: Buffer) => {
        writeSync(descriptor, bytes);
        hash.update(bytes);
        offset += bytes.length;
      };
      const entries = [
        { name: "tasks.json", read: () => tasksJson },
        ...attachments.map((file) => ({
          name: `attachments/${file.name}`,
          read: () => readRegularFile(file.filePath),
        })),
      ];
      if (entries.length > 0xffff)
        throw new CommandError("INVALID_ARGUMENT", "too many files for one export");
      for (const entry of entries) {
        const name = Buffer.from(entry.name);
        const data = entry.read();
        if (offset + 30 + name.length + data.length > 0xffffffff)
          throw new CommandError("INVALID_ARGUMENT", "an export can hold at most 4 GB");
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(UTF8_NAMES, 6);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(20, 6);
        header.writeUInt16LE(UTF8_NAMES, 8);
        header.writeUInt16LE(time, 12);
        header.writeUInt16LE(date, 14);
        header.writeUInt32LE(crc, 16);
        header.writeUInt32LE(data.length, 20);
        header.writeUInt32LE(data.length, 24);
        header.writeUInt16LE(name.length, 28);
        header.writeUInt32LE(offset, 42);
        central.push(header, name);
        write(local);
        write(name);
        write(data);
      }
      const directoryOffset = offset;
      for (const part of central) write(part);
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(entries.length, 8);
      end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(offset - directoryOffset, 12);
      end.writeUInt32LE(directoryOffset, 16);
      write(end);
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
