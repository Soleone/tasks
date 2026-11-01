import browserPath from "path-browserify";

// memfs reads `posix` from node:path, and the backend calls toNamespacedPath for Windows paths.
const path = { ...browserPath, posix: browserPath, toNamespacedPath: (value: string) => value };

export default path;
export const { basename, dirname, isAbsolute, join, normalize, posix, relative, resolve, sep } =
  path;
