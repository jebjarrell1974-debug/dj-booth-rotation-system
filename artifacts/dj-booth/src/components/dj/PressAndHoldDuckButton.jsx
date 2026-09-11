import React, { useCallback, useEffect, useRef, useState } from 'react';
import { VolumeX } from 'lucide-react';

const isActivationKey = event => event.key === ' ' || event.key === 'Enter';

/**
 * A momentary control: there is deliberately no click/toggle action. Every
 * input path ends in the same release function so a lost pointer, hidden tab,
 * keyboard cancellation, or unmount cannot leave music ducked.
 */
export default function PressAndHoldDuckButton({
  onPress,
  onRelease,
  disabled = false,
  label = 'Auto Duck',
  title = 'Hold to duck music',
  className = '',
}) {
  const [held, setHeld] = useState(false);
  const heldRef = useRef(false);
  const pointerIdRef = useRef(null);
  const onPressRef = useRef(onPress);
  const onReleaseRef = useRef(onRelease);
  const buttonRef = useRef(null);

  onPressRef.current = onPress;
  onReleaseRef.current = onRelease;

  const finish = useCallback((reason = 'release') => {
    if (!heldRef.current) return;
    heldRef.current = false;
    setHeld(false);
    const pointerId = pointerIdRef.current;
    pointerIdRef.current = null;
    if (pointerId != null && buttonRef.current?.hasPointerCapture?.(pointerId)) {
      try { buttonRef.current.releasePointerCapture(pointerId); } catch {}
    }
    try { onReleaseRef.current?.(reason); } catch {}
  }, []);

  const onWindowPointerEnd = useCallback(event => {
    if (pointerIdRef.current == null || event.pointerId !== pointerIdRef.current) return;
    finish(event.type === 'pointercancel' ? 'window-pointer-cancel' : 'window-pointer-up');
  }, [finish]);

  const begin = useCallback(event => {
    if (disabled || heldRef.current) return;
    if (event?.type === 'pointerdown') {
      if (event.button != null && event.button !== 0) return;
      pointerIdRef.current = event.pointerId;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
    }
    if (event?.preventDefault) event.preventDefault();
    heldRef.current = true;
    setHeld(true);
    try {
      const result = onPressRef.current?.(event);
      if (result && typeof result.catch === 'function') {
        result.catch(() => finish('press-error'));
      }
    } catch {
      finish('press-error');
    }
  }, [disabled, finish]);

  useEffect(() => {
    const onWindowBlur = () => finish('window-blur');
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') finish('visibility-hidden');
    };
    // Pointer capture is best effort on older touch browsers. The window
    // fallback still releases the lease if capture fails or the pointer exits
    // the document before pointerup reaches the button.
    window.addEventListener('pointerup', onWindowPointerEnd, true);
    window.addEventListener('pointercancel', onWindowPointerEnd, true);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pointerup', onWindowPointerEnd, true);
      window.removeEventListener('pointercancel', onWindowPointerEnd, true);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      finish('unmount');
    };
  }, [finish]);

  useEffect(() => {
    if (disabled) finish('disabled');
  }, [disabled, finish]);

  const onKeyDown = event => {
    if (!isActivationKey(event) || event.repeat) return;
    begin(event);
  };

  const onKeyUp = event => {
    if (!isActivationKey(event)) return;
    event.preventDefault();
    finish('key-release');
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      disabled={disabled}
      title={title}
      aria-label={label}
      aria-pressed={held}
      data-held={held ? 'true' : 'false'}
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
      onContextMenu={event => event.preventDefault()}
      onDragStart={event => event.preventDefault()}
      onPointerDown={begin}
      onPointerUp={() => finish('pointer-up')}
      onPointerCancel={() => finish('pointer-cancel')}
      onLostPointerCapture={() => finish('lost-pointer-capture')}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => finish('button-blur')}
      onClick={event => event.preventDefault()}
      className={`min-w-[82px] h-11 px-2 gap-1 rounded-md border flex items-center justify-center transition-colors touch-none select-none ${
        held
          ? 'bg-[#00d4ff] border-[#00d4ff] text-black shadow-[0_0_12px_rgba(0,212,255,0.55)]'
          : 'bg-[#151528] border-[#2e2e5a] text-[#00d4ff] hover:bg-[#2e2e5a]'
      } disabled:opacity-30 ${className}`}
    >
      <VolumeX className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="text-[10px] font-bold tracking-wide leading-none">AUTO DUCK</span>
    </button>
  );
}