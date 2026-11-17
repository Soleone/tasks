import browserPath from "path-browserify";

// The backend calls toNamespacedPath for Windows paths.
const path = { ...browserPath, toNamespacedPath: (value: string) => value };

export default path;
export const { basename, dirname, isAbsolute, join, normalize, posix, relative, resolve, sep } =
  path;
