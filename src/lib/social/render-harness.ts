/**
 * A recording stand-in for a canvas, so the renderer can be tested in node: every call and every property set
 * is written to a log, text is measured as 0.5 × its font size per character, and images are plain objects.
 * The golden test (render-golden.test.ts) compares the log of existing documents against a stored copy, so a
 * change to the renderer that alters how an old document is drawn shows as a diff.
 */

type Ctx = CanvasRenderingContext2D;
export interface Harness {
  log: string[];
  ctx: Ctx;
  /** An image the renderer will accept (label shows in the log). */
  image: (label: string, w: number, h: number) => HTMLImageElement;
  /** Remove the globals it installed. */
  restore: () => void;
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);

export function makeHarness(): Harness {
  const log: string[] = [];
  const names = new Map<object, string>();
  let canvases = 0, grads = 0;
  const name = (o: unknown): string => {
    if (typeof o === 'number') return num(o);
    if (typeof o === 'string') return JSON.stringify(o);
    if (o && typeof o === 'object') {
      const n = names.get(o as object);
      if (n) return n;
      if (Array.isArray(o)) return `[${o.map(name).join(',')}]`;
      return JSON.stringify(o);
    }
    return String(o);
  };
  const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  function makeCtx(tag: string, canvas: { width: number; height: number }): Ctx {
    const state: Record<string, unknown> = { font: '10px sans-serif', letterSpacing: '0px', globalAlpha: 1, globalCompositeOperation: 'source-over' };
    const fns: Record<string, (...a: unknown[]) => unknown> = {};
    const proxy: object = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'canvas') return canvas;
        if (prop in state) return state[prop];
        if (prop === 'getTransform') return () => identity;
        if (prop === 'measureText') {
          return (s: string) => {
            const px = /(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1];
            return { width: s.length * (px ? Number(px) : 10) * 0.5 };
          };
        }
        if (prop === 'getImageData') {
          return (x: number, y: number, w: number, h: number) => { log.push(`${tag}.getImageData(${num(x)},${num(y)},${num(w)},${num(h)})`); return { data: new Uint8ClampedArray(Math.max(0, w * h * 4)).fill(128), width: w, height: h }; };
        }
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
          return (...a: number[]) => {
            const id = `grad#${++grads}`;
            const g = { addColorStop: (at: number, c: string) => { log.push(`${id}.stop(${num(at)},${c})`); } };
            names.set(g, id);
            log.push(`${tag}.${prop}(${a.map(num).join(',')}) -> ${id}`);
            return g;
          };
        }
        return (fns[prop] ??= (...a: unknown[]) => { log.push(`${tag}.${prop}(${a.map(name).join(',')})`); });
      },
      set(_t, prop: string, v) {
        state[prop] = v;
        log.push(`${tag}.${prop}=${name(v)}`);
        return true;
      },
    });
    return proxy as Ctx;
  }

  const g = globalThis as unknown as Record<string, unknown>;
  const was = { document: g.document, Path2D: g.Path2D };
  g.document = {
    createElement: (el: string) => {
      const c = { width: 0, height: 0, getContext: undefined as unknown };
      const id = `canvas#${++canvases}`;
      names.set(c, id);
      let ctx: Ctx | null = null;
      c.getContext = () => (ctx ??= makeCtx(id, c));
      if (el !== 'canvas') throw new Error('only canvases');
      return c;
    },
  };
  g.Path2D = class { constructor(d?: string) { names.set(this, `path(${d ?? ''})`); } };
  const top = { width: 1080, height: 1920 };
  const ctx = makeCtx('ctx', top);
  return {
    log, ctx,
    image: (label, w, h) => {
      const img = { naturalWidth: w, naturalHeight: h, width: w, height: h, src: `img:${label}` };
      names.set(img, `img:${label}`);
      return img as unknown as HTMLImageElement;
    },
    restore: () => { g.document = was.document; g.Path2D = was.Path2D; },
  };
}
