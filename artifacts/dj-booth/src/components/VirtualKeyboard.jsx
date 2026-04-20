import React, { useEffect, useState, useRef, useCallback } from 'react';

const NUMERIC_TYPES = ['number', 'tel', 'numeric'];
const NUMERIC_MODES = ['numeric', 'decimal', 'tel'];

function isNumericInput(el) {
  if (!el) return false;
  const origMode = el.dataset.vkbdOrigMode || el.inputMode;
  return (
    NUMERIC_TYPES.includes(el.type) ||
    NUMERIC_MODES.includes(origMode) ||
    el.dataset.keyboard === 'numeric'
  );
}

function insertAtCursor(el, char) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const newValue = before + char + after;
  const newPos = start + char.length;

  const nativeSet =
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

  if (nativeSet) {
    nativeSet.call(el, newValue);
  } else {
    el.value = newValue;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  try { el.setSelectionRange(newPos, newPos); } catch (_) {}
}

function deleteAtCursor(el) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  let newValue, newPos;

  if (start !== end) {
    newValue = el.value.slice(0, start) + el.value.slice(end);
    newPos = start;
  } else if (start > 0) {
    newValue = el.value.slice(0, start - 1) + el.value.slice(start);
    newPos = start - 1;
  } else {
    return;
  }

  const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeSet) {
    nativeSet.call(el, newValue);
  } else {
    el.value = newValue;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  try { el.setSelectionRange(newPos, newPos); } catch (_) {}
}

const ROWS_LOWER = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['SHIFT','z','x','c','v','b','n','m','DEL'],
  ['123','SPACE','DONE'],
];

const ROWS_UPPER = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['SHIFT','Z','X','C','V','B','N','M','DEL'],
  ['123','SPACE','DONE'],
];

const ROWS_SYM = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['-','/',':', ';','(',')','\u20ac','&','@','"'],
  ['#','%','\\','^','*','+','=','_','~','DEL'],
  ['ABC','SPACE','DONE'],
];

const ROWS_NUM = [
  ['1','2','3'],
  ['4','5','6'],
  ['7','8','9'],
  ['.','0','DEL'],
  ['ABC','DONE'],
];

const SPECIAL = new Set(['SHIFT','DEL','123','ABC','SPACE','DONE']);

const KEY_H = 56;
const GAP = 6;
const PAD_H = 12;

function Key({ label, onPress, wide, extraWide, accent, danger, muted, active }) {
  const pressRef = useRef(false);

  const handlePointerDown = (e) => {
    e.preventDefault();
    pressRef.current = true;
  };

  const handlePointerUp = (e) => {
    e.preventDefault();
    if (pressRef.current) {
      pressRef.current = false;
      onPress(label);
    }
  };

  const handlePointerLeave = () => {
    pressRef.current = false;
  };

  let bg = 'rgba(255,255,255,0.08)';
  let border = 'rgba(0,212,255,0.2)';
  let color = '#fff';
  let shadow = 'none';
  let fontWeight = '500';
  let flexGrow = 1;

  if (wide) flexGrow = 2;
  if (extraWide) flexGrow = 4;

  if (accent) {
    bg = 'rgba(0,212,255,0.15)';
    border = 'rgba(0,212,255,0.5)';
    color = '#00d4ff';
    fontWeight = '700';
    shadow = '0 0 8px rgba(0,212,255,0.3)';
  }
  if (danger) {
    bg = 'rgba(255,45,85,0.12)';
    border = 'rgba(255,45,85,0.35)';
    color = '#ff6b8a';
  }
  if (muted) {
    bg = 'rgba(255,255,255,0.04)';
    border = 'rgba(255,255,255,0.1)';
    color = '#8a9ab0';
  }
  if (active) {
    bg = 'rgba(0,212,255,0.28)';
    shadow = '0 0 10px rgba(0,212,255,0.4)';
  }

  let display = label;
  if (label === 'DEL') display = '⌫';
  if (label === 'SHIFT') display = '⇧';
  if (label === 'SPACE') display = '';
  if (label === 'DONE') display = 'Done';

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      style={{
        flexGrow,
        minWidth: 0,
        height: `${KEY_H}px`,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: '10px',
        color,
        fontSize: SPECIAL.has(label) ? '14px' : '20px',
        fontWeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        touchAction: 'manipulation',
        boxShadow: shadow,
        transition: 'background 0.08s, box-shadow 0.08s',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {display}
    </div>
  );
}

function KeyRow({ keys, onPress, caps }) {
  return (
    <div style={{ display: 'flex', gap: `${GAP}px`, width: '100%' }}>
      {keys.map((k, i) => {
        const isWide = k === 'SHIFT' || k === 'DEL';
        const isExtraWide = k === 'SPACE';
        const isAccent = k === 'DONE' || k === 'ABC';
        const isDanger = false;
        const isMuted = k === '123' || k === 'SHIFT';
        const isActive = caps && k === 'SHIFT';
        return (
          <Key
            key={i}
            label={k}
            onPress={onPress}
            wide={isWide}
            extraWide={isExtraWide}
            accent={isAccent}
            danger={isDanger}
            muted={isMuted}
            active={isActive}
          />
        );
      })}
    </div>
  );
}

const KBD_HEIGHT_QWERTY = (KEY_H + GAP) * 4 + PAD_H * 2 + 8;
const KBD_HEIGHT_NUM = (KEY_H + GAP) * 5 + PAD_H * 2 + 8;

const SKIP_TYPES = new Set(['range','checkbox','radio','file','submit','button','reset','hidden','color']);

function suppressOSKeyboard(root) {
  (root.querySelectorAll ? root.querySelectorAll('input, textarea') : []).forEach(el => {
    if (SKIP_TYPES.has(el.type)) return;
    if (el.readOnly || el.disabled) return;
    if (!el.dataset.vkbdOrigMode) {
      el.dataset.vkbdOrigMode = el.getAttribute('inputmode') || '';
    }
    el.setAttribute('inputmode', 'none');
  });
}

// Walk up DOM to find the actual scrollable ancestor
function getScrollParent(el) {
  let node = el.parentElement;
  while (node && node !== document.body) {
    const { overflowY, overflow } = window.getComputedStyle(node);
    const scrollable = overflowY === 'auto' || overflowY === 'scroll' ||
                       overflow === 'auto' || overflow === 'scroll';
    if (scrollable && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

export default function VirtualKeyboard() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState('lower');
  const [numpad, setNumpad] = useState(false);
  const [anim, setAnim] = useState(false);
  const activeInputRef = useRef(null);
  const hideTimerRef = useRef(null);
  const scrollTimerRef = useRef(null);
  const paddedContainerRef = useRef(null);
  const originalPaddingRef = useRef('');

  useEffect(() => {
    suppressOSKeyboard(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const tag = node.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA') {
            suppressOSKeyboard(document.body);
          } else if (node.querySelectorAll) {
            suppressOSKeyboard(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const kbdHeight = numpad ? KBD_HEIGHT_NUM : KBD_HEIGHT_QWERTY;

  const clearContainerPadding = useCallback(() => {
    if (paddedContainerRef.current) {
      paddedContainerRef.current.style.paddingBottom = originalPaddingRef.current;
      paddedContainerRef.current = null;
      originalPaddingRef.current = '';
    }
  }, []);

  const scrollInputIntoView = useCallback((el, kbdH) => {
    clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      if (!el) return;

      // Find the real scrollable parent (not window)
      const container = getScrollParent(el);

      // Add bottom padding to the container so content can scroll past the keyboard
      clearContainerPadding();
      paddedContainerRef.current = container;
      originalPaddingRef.current = container.style.paddingBottom || '';
      const existingPad = parseInt(window.getComputedStyle(container).paddingBottom, 10) || 0;
      const neededPad = kbdH + 24;
      if (existingPad < neededPad) {
        container.style.paddingBottom = `${neededPad}px`;
      }

      // After padding is applied, scroll so the input is visible above the keyboard
      setTimeout(() => {
        const rect = el.getBoundingClientRect();
        const containerRect = container === document.documentElement
          ? { top: 0, bottom: window.innerHeight }
          : container.getBoundingClientRect();
        const visibleBottom = Math.min(containerRect.bottom, window.innerHeight) - kbdH - 20;
        if (rect.bottom > visibleBottom) {
          const scrollBy = rect.bottom - visibleBottom + 16;
          if (container === document.documentElement) {
            window.scrollBy({ top: scrollBy, behavior: 'smooth' });
          } else {
            container.scrollBy({ top: scrollBy, behavior: 'smooth' });
          }
        }
      }, 50);
    }, 80);
  }, [clearContainerPadding]);

  const show = useCallback((el) => {
    clearTimeout(hideTimerRef.current);
    activeInputRef.current = el;
    const isNum = isNumericInput(el);
    const kbdH = isNum ? KBD_HEIGHT_NUM : KBD_HEIGHT_QWERTY;
    setNumpad(isNum);
    setMode('lower');
    setVisible(true);
    setTimeout(() => setAnim(true), 10);
    scrollInputIntoView(el, kbdH);
  }, [scrollInputIntoView]);

  const hide = useCallback(() => {
    hideTimerRef.current = setTimeout(() => {
      setAnim(false);
      clearContainerPadding();
      setTimeout(() => {
        setVisible(false);
        activeInputRef.current = null;
      }, 220);
    }, 120);
  }, [clearContainerPadding]);

  useEffect(() => {
    const onFocusIn = (e) => {
      const el = e.target;
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return;
      if (el.readOnly || el.disabled) return;
      if (['range','checkbox','radio','file'].includes(el.type)) return;
      show(el);
    };
    const onFocusOut = (e) => {
      const el = e.target;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') hide();
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      clearTimeout(hideTimerRef.current);
      clearTimeout(scrollTimerRef.current);
    };
  }, [show, hide]);

  const handleKey = useCallback((label) => {
    const el = activeInputRef.current;

    if (label === 'DONE') {
      if (el) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        el.blur();
      }
      setAnim(false);
      setTimeout(() => { setVisible(false); activeInputRef.current = null; }, 220);
      return;
    }

    if (label === 'SHIFT') {
      setMode(prev => prev === 'upper' ? 'lower' : 'upper');
      return;
    }

    if (label === '123') {
      setNumpad(false);
      setMode('sym');
      return;
    }

    if (label === 'ABC') {
      setNumpad(false);
      setMode('lower');
      return;
    }

    if (!el) return;

    if (label === 'DEL') {
      deleteAtCursor(el);
      return;
    }

    if (label === 'SPACE') {
      insertAtCursor(el, ' ');
      return;
    }

    insertAtCursor(el, label);
    if (mode === 'upper') setMode('lower');
  }, [mode]);

  if (!visible) return null;

  const rows = numpad ? ROWS_NUM : (mode === 'upper' ? ROWS_UPPER : mode === 'sym' ? ROWS_SYM : ROWS_LOWER);

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onPointerDown={(e) => {
          e.preventDefault();
          if (activeInputRef.current) activeInputRef.current.blur();
          setAnim(false);
          setTimeout(() => { setVisible(false); activeInputRef.current = null; }, 220);
        }}
      />
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: 'rgba(6,6,22,0.97)',
          borderTop: '1px solid rgba(0,212,255,0.3)',
          backdropFilter: 'blur(16px)',
          padding: `${PAD_H}px 10px ${PAD_H + 4}px`,
          boxShadow: '0 -4px 40px rgba(0,212,255,0.12)',
          transform: anim ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          display: 'flex',
          flexDirection: 'column',
          gap: `${GAP}px`,
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          clearTimeout(hideTimerRef.current);
        }}
      >
        {rows.map((row, i) => (
          <KeyRow key={i} keys={row} onPress={handleKey} caps={mode === 'upper'} />
        ))}
      </div>
    </>
  );
}
