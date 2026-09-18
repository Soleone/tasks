/**
 * The only source of truth for the product's user-facing name.
 *
 * Keep the data directory stable when rebranding so existing workspaces remain
 * available. Change APP_NAME for a new product name; APP_DATA_DIRECTORY is a
 * storage compatibility detail, not part of the brand.
 */
export const APP_NAME = "Tasks";
export const APP_DATA_DIRECTORY = "com.soleone.tasks";
