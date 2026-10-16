import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from "react";
import type { MainWorkspace } from "@/platform/mainWorkspace";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Field, FieldLabel } from "./ui/field";
import { Textarea } from "./ui/textarea";
import { AnchoredDialogContent } from "@/components/variants/dialog";

/** Appears only when a sent workspace request has no verified success reply. */
export function WorkspaceRequestRecovery({
  workspace,
}: {
  workspace: MainWorkspace;
}): ReactElement | null {
  const request = useSyncExternalStore(workspace.subscribe, workspace.getUnresolved);
  const [busy, setBusy] = useState(false);
  const [preserved, setPreserved] = useState(false);
  const [copied, setCopied] = useState(false);
  const retryRef = useRef<HTMLButtonElement>(null);
  // A new unresolved request starts unpreserved.
  const [shownRequest, setShownRequest] = useState(request?.prepared);
  if (shownRequest !== request?.prepared) {
    setShownRequest(request?.prepared);
    setPreserved(false);
    setCopied(false);
  }

  useEffect(() => {
    const protectReload = (event: BeforeUnloadEvent): void => {
      if (!workspace.hasWriteInProgress()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectReload);
    return () => window.removeEventListener("beforeunload", protectReload);
  }, [workspace]);

  if (!request) return null;
  return (
    <Dialog open disablePointerDismissal onOpenChange={() => undefined}>
      <AnchoredDialogContent
        showCloseButton={false}
        initialFocus={retryRef}
        className="overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>Workspace request needs attention</DialogTitle>
          <DialogDescription>
            Your original request is retained. Do not submit a replacement or close the app until
            you have preserved it.
          </DialogDescription>
        </DialogHeader>
        <Alert>
          <AlertDescription>{request.error}</AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Button
            ref={retryRef}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void request.retry().finally(() => setBusy(false));
            }}
          >
            {busy ? "Retrying…" : "Retry same request"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  JSON.stringify(
                    {
                      originalRequest: JSON.parse(request.prepared.originalRequest),
                      paths: JSON.parse(request.prepared.retryMetadata),
                    },
                    null,
                    2,
                  ),
                )
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            Copy request and paths
          </Button>
        </div>
        {copied && <p role="status">Request and paths copied.</p>}
        <details>
          <summary className="cursor-pointer">Original request and paths</summary>
          <div className="mt-3 flex min-w-0 flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="main-original-request">Original request</FieldLabel>
              <Textarea
                id="main-original-request"
                value={request.prepared.originalRequest}
                readOnly
                rows={4}
              />
            </Field>
            <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">
              {request.prepared.retryMetadata}
            </pre>
          </div>
        </details>
        <p className="text-sm text-muted-foreground">
          Retry sends this exact request, not a new change. It lives only in this window. Pending
          recovery must be completed explicitly outside the app.
        </p>
        <Field orientation="horizontal">
          <Checkbox
            id="main-preserved-request"
            checked={preserved}
            onCheckedChange={setPreserved}
            disabled={busy}
          />
          <FieldLabel htmlFor="main-preserved-request">
            I preserved the request and paths for external reconciliation.
          </FieldLabel>
        </Field>
        <Button
          variant="outline"
          disabled={busy || !preserved}
          onClick={request.preserveForReconciliation}
        >
          Pause writes for reconciliation
        </Button>
      </AnchoredDialogContent>
    </Dialog>
  );
}
