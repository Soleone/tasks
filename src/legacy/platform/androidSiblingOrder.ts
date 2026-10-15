export class AndroidSiblingOrderConflict extends Error {
  readonly code = "SIBLING_ORDER_CONFLICT";

  constructor() {
    super("sibling order changed in the selected folder; refresh and retry the reorder");
    this.name = "AndroidSiblingOrderConflict";
  }
}

export function assertAndroidSiblingOrder(expected: string[], actual: string[]): void {
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new AndroidSiblingOrderConflict();
  }
}
