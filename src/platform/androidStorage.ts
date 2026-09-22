import { invoke } from "@tauri-apps/api/core";

export type AndroidStorageValue = {
  type: "text";
  value: string;
};

export type AndroidTaskInput = {
  id: string;
  title: string;
  descriptionMarkdown: string;
  status: string;
  categoryId: string | null;
  parentId: string | null;
  position: number;
  priority: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
};

export type AndroidImportedClassification = {
  slug: string;
  label: string;
};

export type AndroidImportedTask = {
  id: string;
  title: string;
  descriptionMarkdown: string;
  status: string;
  priority: number;
  category: AndroidImportedClassification | null;
  tags: AndroidImportedClassification[];
  parentId: string | null;
  dependencyIds: string[];
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  canceledAt: string | null;
};

export type AndroidStorageRequest =
  | { operation: "probe" }
  | { operation: "begin"; transactionId: string }
  | {
    operation: "run";
    transactionId: string;
    statement: "probe.reset" | "probe.insert";
    values?: AndroidStorageValue[];
  }
  | { operation: "all"; statement: "probe.reset" | "probe.insert" }
  | { operation: "readSnapshot" }
  | { operation: "readReceipt"; idempotencyKey: string }
  | { operation: "readCanonicalMeta" }
  | { operation: "replaceCanonicalWorkspace"; workspaceId: string; fingerprint: string; tasks: AndroidImportedTask[] }
  | { operation: "ensureCategory"; transactionId: string; id: string; slug: string; label: string; now: string }
  | { operation: "ensureTag"; transactionId: string; id: string; slug: string; label: string; now: string }
  | { operation: "shiftSiblingPositions"; transactionId: string; parentId: string | null }
  | { operation: "insertTask"; transactionId: string; task: AndroidTaskInput }
  | { operation: "insertTaskTag"; transactionId: string; taskId: string; tagId: string }
  | {
    operation: "insertActivity";
    transactionId: string;
    taskId: string;
    requestId: string;
    action: string;
    actorKind: string;
    actorLabel: string;
    createdAt: string;
    detailsJson: string;
  }
  | {
    operation: "writeReceipt";
    transactionId: string;
    idempotencyKey: string;
    command: string;
    requestHash: string;
    responseJson: string;
    createdAt: string;
  }
  | { operation: "commit"; transactionId: string }
  | { operation: "rollback"; transactionId: string }
  | { operation: "close"; transactionId: string };

export type AndroidStorageResponse = Record<string, unknown>;

export function androidStorage(request: AndroidStorageRequest): Promise<AndroidStorageResponse> {
  return invoke<AndroidStorageResponse>("android_storage", { request });
}
