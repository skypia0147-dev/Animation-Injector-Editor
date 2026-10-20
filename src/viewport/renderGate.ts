// Coalesce invalidations; a stationary or hidden viewport has no frame loop.
export function createRenderGate(
  request: (fn: () => void) => number,
  cancel: (id: number) => void,
  render: () => void
) {
  let pending: number | undefined,
    disposed = false,
    visible = true,
    dirty = false;
  const invalidate = () => {
    dirty = true;
    if (disposed || !visible || pending !== undefined) return;
    pending = request(() => {
      pending = undefined;
      if (disposed || !visible) return;
      dirty = false;
      render();
    });
  };
  return {
    invalidate,
    setVisible(value: boolean) {
      visible = value;
      if (!visible && pending !== undefined) {
        cancel(pending);
        pending = undefined;
      }
      if (visible && dirty) invalidate();
    },
    dispose() {
      disposed = true;
      if (pending !== undefined) cancel(pending);
      pending = undefined;
    },
  };
}
