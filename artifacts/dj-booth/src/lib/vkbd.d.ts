// Types for vkbd.js — the shared virtual-keyboard outside-dismiss guard.
export declare const isVirtualKeyboardEvent: (event: { target: EventTarget | null; detail?: any }) => boolean;

type OutsideHandlers = {
  onPointerDownOutside?: (event: any) => void;
  onInteractOutside?: (event: any) => void;
  onFocusOutside?: (event: any) => void;
};

export declare const guardOutsideEvents: (handlers?: OutsideHandlers) => {
  onPointerDownOutside: (event: any) => void;
  onInteractOutside: (event: any) => void;
  onFocusOutside: (event: any) => void;
};
