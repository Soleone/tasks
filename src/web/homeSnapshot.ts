import { vol } from "memfs";

type Entry = { path: string; ino: number; bytes: Uint8Array | null };

/** Every file and folder in memfs with its inode number, parents first. */
export type HomeSnapshot = { nextIno: number; releasedInos: number[]; entries: Entry[] };

export function snapshotFiles(): HomeSnapshot {
  const entries: Entry[] = [];
  const walk = (directory: string) => {
    for (const name of vol.readdirSync(directory) as string[]) {
      const path = `${directory === "/" ? "" : directory}/${name}`;
      const stat = vol.lstatSync(path);
      const directoryEntry = stat.isDirectory();
      entries.push({
        path,
        ino: Number(stat.ino),
        bytes: directoryEntry ? null : new Uint8Array(vol.readFileSync(path) as Uint8Array),
      });
      if (directoryEntry) walk(path);
    }
  };
  walk("/");
  return { nextIno: vol._core.ino, releasedInos: [...vol._core.releasedInos], entries };
}

/**
 * Recreates the files with their old inode numbers. The cache records the inodes of the task
 * folder and of itself, and new ones would make the home look copied, which starts a new history.
 * memfs takes a new node's number from the end of releasedInos before counting up; it is pinned
 * in package.json because this relies on that.
 */
export function restoreFiles(snapshot: HomeSnapshot): void {
  vol.reset();
  for (const { path, ino, bytes } of snapshot.entries) {
    vol._core.releasedInos.push(ino);
    if (bytes) vol.writeFileSync(path, bytes);
    else vol.mkdirSync(path);
  }
  vol._core.ino = snapshot.nextIno;
  vol._core.releasedInos = [...snapshot.releasedInos];
}
