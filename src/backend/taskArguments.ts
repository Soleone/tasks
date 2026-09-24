import { CommandError } from "./errors.js";

type Row = Record<string, unknown>;

export function optionalString(args: Row, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new CommandError("INVALID_ARGUMENT", `${name} must be a string`);
  }
  return value;
}

export function requiredString(args: Row, name: string): string {
  const value = optionalString(args, name);
  if (value === undefined || value.trim() === "") {
    throw new CommandError("INVALID_ARGUMENT", `${name} is required`);
  }
  return value;
}

export function optionalInteger(args: Row, name: string, defaultValue: number): number {
  const value = args[name];
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CommandError("INVALID_ARGUMENT", `${name} must be an integer`);
  }
  return value;
}
