// Imported first by the worker: the backend and memfs use these Node globals at load time.
import { Buffer } from "./shims/buffer";
import process from "./shims/process";

Object.assign(globalThis, { Buffer, process });
