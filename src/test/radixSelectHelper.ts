// jsdom lacks a few pointer APIs Radix Select calls. Test-only helper to open a Select and choose an option by its text.
import { fireEvent, screen } from "@testing-library/react";

export function polyfillRadix() {
  const p = Element.prototype as any;
  p.hasPointerCapture ??= () => false; p.setPointerCapture ??= () => {}; p.releasePointerCapture ??= () => {}; p.scrollIntoView ??= () => {};
}
export async function chooseOption(trigger: HTMLElement, optionText: RegExp | string) {
  // jsdom drops PointerEvent.pointerType, so drive Radix with the keyboard, which it supports for opening and choosing
  fireEvent.keyDown(trigger, { key: "Enter" });
  const opt = await screen.findByRole("option", { name: optionText });
  fireEvent.keyDown(opt, { key: "Enter" });
}
