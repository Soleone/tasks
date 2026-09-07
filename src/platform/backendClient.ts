import { PROTOCOL_VERSION, type RuntimeProbeResult } from "../backend/protocol";
import { BackendSession } from "./backendSession";

export type ProbeResult = RuntimeProbeResult;

const session = new BackendSession();

export async function runRuntimeProbe(): Promise<ProbeResult> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("The runtime probe is available when the desktop shell is running.");
  }

  const response = await session.request({
    version: PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    command: "runtime.probe",
  });

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  return response.result;
}

export async function closeBackendSession(): Promise<void> {
  await session.close();
}
