import { fs } from "memfs";

export default fs;
export const {
  closeSync,
  constants,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} = fs;
export const fstatSync = fs.fstatSync.bind(fs);
