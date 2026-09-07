import type { RuntimeProbeResult } from "../backend/protocol";

export type ProbeResult = RuntimeProbeResult;

export async function runRuntimeProbe(): Promise<ProbeResult> {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("The runtime probe is available when the desktop shell is running.");
  }

  const { Command } = await import("@tauri-apps/plugin-shell");
  const command = Command.sidecar("binaries/tasks-backend", ["--probe"]);
  const output = await command.execute();

  if (output.code !== 0) {
    throw new Error(output.stderr.trim() || `Backend exited with code ${output.code ?? "unknown"}`);
  }

  const response = JSON.parse(output.stdout) as
    | { ok: true; result: RuntimeProbeResult }
    | { ok: false; error: { message: string } };

  if (!response.ok) {
    throw new Error(response.error.message);
  }

  return response.result;
}
