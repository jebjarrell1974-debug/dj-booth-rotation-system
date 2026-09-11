/**
 * Small, DOM-free lifecycle for the shared announcement element.
 *
 * A new generation cancels the previous generation before it can replace
 * event handlers. Each generation gets a unique duck owner so completion of
 * one voice cannot release another voice's duck.
 */
export function createAnnouncementLifecycle({ ownerPrefix = 'voiceover' } = {}) {
  let generation = 0;
  let ownerCounter = 0;
  let active = null;

  const start = cancel => {
    active?.cancel?.('superseded');
    const token = {
      generation: ++generation,
      ownerId: `${ownerPrefix}:${++ownerCounter}`,
    };
    active = { token, cancel };
    return token;
  };

  const setCancel = (token, cancel) => {
    if (active?.token === token) active.cancel = cancel;
  };

  const isCurrent = token => (
    active?.token === token && token.generation === generation
  );

  const finish = token => {
    if (active?.token === token) active = null;
  };

  const cancelActive = (reason = 'cancelled') => {
    const current = active;
    current?.cancel?.(reason);
    if (active === current) active = null;
    generation += 1;
  };

  return {
    start,
    setCancel,
    isCurrent,
    finish,
    cancelActive,
    getGeneration: () => generation,
    getActiveOwner: () => active?.token.ownerId || null,
  };
}