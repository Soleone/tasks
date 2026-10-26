/** The filter toolbar's solid theme ring, shared by keyboard-focusable app controls. */
export const FOCUS_RING =
  "focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:ring-ring focus-visible:outline-none";

/** Stock composite components own their buttons, so style those without replacing their behavior. */
export const NESTED_BUTTON_FOCUS =
  "[&_button:focus-visible]:ring-2 [&_button:focus-visible]:ring-ring [&_button:focus-visible]:outline-none";
