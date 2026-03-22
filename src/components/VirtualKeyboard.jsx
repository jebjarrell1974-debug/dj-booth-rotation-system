import React, { useEffect, useState, useRef, useCallback } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

const NUMERIC_TYPES = ['number', 'tel', 'numeric'];
const NUMERIC_MODES = ['numeric', 'decimal', 'tel'];

function isNumericInput(el) {
  if (!el) return false;
  return (
    NUMERIC_TYPES.includes(el.type) ||
    NUMERIC_MODES.includes(el.inputMode) ||
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

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, newValue);
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

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, newValue);
  } else {
    el.value = newValue;
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));

  try { el.setSelectionRange(newPos, newPos); } catch (_) {}
}

export default function VirtualKeyboard() {
  const [visible, setVisible] = useState(false);
  const [layout, setLayout] = useState('default');
  const [keyboardLayout, setKeyboardLayout] = useState('default');
  const activeInputRef = useRef(null);
  const hideTimeoutRef = useRef(null);
  const keyboardRef = useRef(null);

  const show = useCallback((el) => {
    clearTimeout(hideTimeoutRef.current);
    activeInputRef.current = el;
    setKeyboardLayout(isNumericInput(el) ? 'numeric' : 'default');
    setLayout('default');
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      activeInputRef.current = null;
    }, 150);
  }, []);

  useEffect(() => {
    const onFocusIn = (e) => {
      const el = e.target;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.readOnly || el.disabled) return;
        if (el.type === 'range' || el.type === 'checkbox' || el.type === 'radio' || el.type === 'file') return;
        show(el);
      }
    };
    const onFocusOut = (e) => {
      const el = e.target;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        hide();
      }
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      clearTimeout(hideTimeoutRef.current);
    };
  }, [show, hide]);

  const onKeyPress = useCallback((button) => {
    const el = activeInputRef.current;
    if (!el) return;

    if (button === '{bksp}') {
      deleteAtCursor(el);
    } else if (button === '{enter}' || button === '{done}') {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
      setVisible(false);
      el.blur();
    } else if (button === '{space}') {
      insertAtCursor(el, ' ');
    } else if (button === '{shift}' || button === '{lock}') {
      setLayout(prev => prev === 'default' ? 'shift' : 'default');
    } else if (button === '{numbers}') {
      setKeyboardLayout('numeric');
      setLayout('default');
    } else if (button === '{abc}') {
      setKeyboardLayout('default');
      setLayout('default');
    } else if (button === '{hide}') {
      setVisible(false);
      el.blur();
    } else {
      insertAtCursor(el, button);
      if (layout === 'shift') setLayout('default');
    }
  }, [layout]);

  const layouts = {
    default: {
      default: [
        'q w e r t y u i o p {bksp}',
        'a s d f g h j k l {enter}',
        '{shift} z x c v b n m , . {shift}',
        '{numbers} {space} {hide}'
      ],
      shift: [
        'Q W E R T Y U I O P {bksp}',
        'A S D F G H J K L {enter}',
        '{shift} Z X C V B N M , . {shift}',
        '{numbers} {space} {hide}'
      ]
    },
    numeric: {
      default: [
        '1 2 3',
        '4 5 6',
        '7 8 9',
        '. 0 {bksp}',
        '{abc} {done} {hide}'
      ]
    }
  };

  const display = {
    '{bksp}': '⌫',
    '{enter}': '↵',
    '{shift}': '⇧',
    '{space}': ' ',
    '{done}': 'Done',
    '{hide}': '✕',
    '{numbers}': '123',
    '{abc}': 'ABC',
    '{lock}': '⇪'
  };

  if (!visible) return null;

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onMouseDown={(e) => {
          e.preventDefault();
          clearTimeout(hideTimeoutRef.current);
        }}
      />
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: 'rgba(8, 8, 26, 0.97)',
          borderTop: '1px solid rgba(0, 212, 255, 0.3)',
          backdropFilter: 'blur(12px)',
          padding: '8px 8px 12px',
          boxShadow: '0 -4px 32px rgba(0, 212, 255, 0.15)'
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          clearTimeout(hideTimeoutRef.current);
        }}
        onTouchStart={(e) => {
          clearTimeout(hideTimeoutRef.current);
        }}
      >
        <style>{`
          .vkb .hg-theme-default {
            background: transparent;
            border-radius: 0;
            padding: 0;
            font-family: inherit;
          }
          .vkb .hg-theme-default .hg-button {
            background: rgba(255,255,255,0.07);
            border: 1px solid rgba(0,212,255,0.2);
            color: #fff;
            border-radius: 8px;
            height: 48px;
            font-size: 18px;
            font-weight: 500;
            box-shadow: none;
            transition: background 0.1s;
          }
          .vkb .hg-theme-default .hg-button:active,
          .vkb .hg-theme-default .hg-button.hg-activeButton {
            background: rgba(0, 212, 255, 0.25);
            border-color: rgba(0, 212, 255, 0.6);
          }
          .vkb .hg-theme-default .hg-button[data-skbtn="{bksp}"],
          .vkb .hg-theme-default .hg-button[data-skbtn="{shift}"],
          .vkb .hg-theme-default .hg-button[data-skbtn="{numbers}"],
          .vkb .hg-theme-default .hg-button[data-skbtn="{abc}"] {
            background: rgba(255,255,255,0.04);
            color: #a0aec0;
          }
          .vkb .hg-theme-default .hg-button[data-skbtn="{enter}"],
          .vkb .hg-theme-default .hg-button[data-skbtn="{done}"] {
            background: rgba(0, 212, 255, 0.15);
            border-color: rgba(0, 212, 255, 0.4);
            color: #00d4ff;
            font-weight: 700;
          }
          .vkb .hg-theme-default .hg-button[data-skbtn="{hide}"] {
            background: rgba(255, 45, 85, 0.12);
            border-color: rgba(255, 45, 85, 0.3);
            color: #ff2d55;
          }
          .vkb .hg-theme-default .hg-button[data-skbtn="{space}"] {
            flex-grow: 3;
          }
          .vkb .hg-theme-default .hg-row {
            gap: 6px;
            margin-bottom: 6px;
          }
          .vkb .hg-theme-default .hg-row:last-child {
            margin-bottom: 0;
          }
        `}</style>
        <div className="vkb">
          <Keyboard
            keyboardRef={r => (keyboardRef.current = r)}
            layoutName={layout}
            layout={layouts[keyboardLayout]}
            display={display}
            onKeyPress={onKeyPress}
            physicalKeyboardHighlight={false}
            syncInstanceInputs={false}
            preventMouseDownDefault={true}
          />
        </div>
      </div>
    </>
  );
}
