import type { LucideIcon } from "lucide-react";
import {
  Toast,
  ToastClose,
  ToastContent,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  toast,
  useToastManager,
} from "@/components/ui/toast";

/** What a task toast shows next to its title: a status icon, drawn as the check animation for done. */
export type TaskToastData = { icon?: LucideIcon; completion?: boolean };

const TOAST_TIMEOUT_MS = 3000;

export function showTaskToast(title: string, data: TaskToastData = {}): void {
  toast.add({ title, data, timeout: TOAST_TIMEOUT_MS });
}

/** The stock toaster, with each toast's status icon in place of the stock type icons. */
export function TaskToaster() {
  return (
    <ToastProvider toastManager={toast}>
      <ToastPortal>
        <ToastViewport>
          <TaskToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

function TaskToastList() {
  const { toasts } = useToastManager<TaskToastData>();
  return toasts.map((item) => {
    const Icon = item.data?.icon;
    return (
      <Toast key={item.id} toast={item}>
        <ToastContent>
          {Icon ? (
            <Icon
              aria-hidden="true"
              className={
                item.data?.completion ? "size-4 shrink-0 task-completion-icon" : "size-4 shrink-0"
              }
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <ToastTitle />
          </div>
          <ToastClose />
        </ToastContent>
      </Toast>
    );
  });
}
