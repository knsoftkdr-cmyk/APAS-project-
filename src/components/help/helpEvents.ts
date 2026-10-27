// Lets the help menu open Ask APAS (the AI command bar) without importing it, same pattern as tourEvents.ts.
export const OPEN_COMMAND_BAR_EVENT = "apas:open-command-bar";

export function openAskApas() {
  window.dispatchEvent(new CustomEvent(OPEN_COMMAND_BAR_EVENT));
}
