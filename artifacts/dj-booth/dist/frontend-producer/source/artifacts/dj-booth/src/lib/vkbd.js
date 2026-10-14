// The global on-screen VirtualKeyboard renders OUTSIDE Radix overlay portals.
// Without this guard, tapping any keyboard key counts as an "outside
// interaction" and instantly closes the overlay — the fleet-wide "keyboard
// closes the Add Entertainer dialog" bug. Every Radix-style overlay wrapper
// (dialog, alert-dialog, sheet, drawer, popover, ...) must run its
// onPointerDownOutside / onInteractOutside / onFocusOutside handlers through
// this check.
export const isVirtualKeyboardEvent = (event) => {
  // While the keyboard is up, the first outside tap should only dismiss the
  // keyboard — never the overlay.
  if (document.body.classList.contains("vkbd-open")) return true;
  const target = event.detail?.originalEvent?.target ?? event.target;
  return target instanceof Element && !!target.closest("[data-virtual-keyboard]");
};

// Wraps the three Radix "outside" callbacks so virtual-keyboard interactions
// never dismiss the overlay. Spread the result onto the primitive Content.
export const guardOutsideEvents = ({ onPointerDownOutside, onInteractOutside, onFocusOutside } = {}) => ({
  onPointerDownOutside: (event) => {
    if (isVirtualKeyboardEvent(event)) { event.preventDefault(); return; }
    onPointerDownOutside?.(event);
  },
  onInteractOutside: (event) => {
    if (isVirtualKeyboardEvent(event)) { event.preventDefault(); return; }
    onInteractOutside?.(event);
  },
  onFocusOutside: (event) => {
    if (isVirtualKeyboardEvent(event)) { event.preventDefault(); return; }
    onFocusOutside?.(event);
  },
});
