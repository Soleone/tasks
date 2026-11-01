/** memfs takes file URLs as paths too; the backend only passes strings. */
export const fileURLToPath = (url: string | URL): string => new URL(url).pathname;
