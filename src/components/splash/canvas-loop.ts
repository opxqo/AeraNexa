// A canvas kept sized to its CSS box, redrawn every frame (or once per resize when `animate`
// is off, for reduced motion). Shared by the three splash stages.

export type CanvasFrame = {
  /** Drawing width / height: CSS pixels, or grid cells when a `grid` is given. */
  width: number;
  height: number;
  now: number;
  dt: number;
};

type Options = {
  animate?: boolean;
  maxDpr?: number;
  /** A low-resolution backing store (pixel art): the canvas is `cols × rows` cells, scaled up by CSS. */
  grid?: (cssWidth: number, cssHeight: number) => { cols: number; rows: number };
};

export function runCanvas(
  canvas: HTMLCanvasElement,
  render: (context: CanvasRenderingContext2D, frame: CanvasFrame) => void,
  { animate = true, maxDpr = 2, grid }: Options = {},
) {
  const context = canvas.getContext("2d");
  if (!context) return () => {};

  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;
  let last = performance.now();
  let disposed = false;

  const measure = () => {
    const box = canvas.getBoundingClientRect();
    if (grid) {
      const { cols, rows } = grid(box.width, box.height);
      canvas.width = cols;
      canvas.height = rows;
      width = cols;
      height = rows;
      dpr = 1;
    } else {
      dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      width = box.width;
      height = box.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    }
  };

  const paint = (now: number, dt: number) => {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(context, { width, height, now, dt });
  };

  const loop = (now: number) => {
    if (disposed) return;
    const dt = Math.min(64, now - last);
    last = now;
    paint(now, dt);
    raf = requestAnimationFrame(loop);
  };

  measure();
  if (animate) raf = requestAnimationFrame(loop);
  else paint(performance.now(), 16);

  const observer = new ResizeObserver(() => {
    measure();
    if (!animate) paint(performance.now(), 16);
  });
  observer.observe(canvas);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
  };
}
