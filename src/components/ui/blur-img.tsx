'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A photo that arrives blurred on a muted ground and settles sharp once it has loaded (blur 12 px and a
 * 4% scale, 300 ms; no motion at all under Reduce Motion, where it simply appears). For the photo grids
 * (stock, catalogue picker, order photos). An image already in the cache skips the blur.
 */
export const BlurImg = React.forwardRef<HTMLImageElement, React.ImgHTMLAttributes<HTMLImageElement>>(
  function BlurImg({ className, onLoad, onError, alt = '', ...props }, ref) {
    const inner = React.useRef<HTMLImageElement | null>(null);
    const [loaded, setLoaded] = React.useState(false);
    React.useEffect(() => { setLoaded(!!inner.current?.complete && !!inner.current?.naturalWidth); }, [props.src]);
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...props}
        alt={alt}
        ref={(node) => {
          inner.current = node;
          if (typeof ref === 'function') ref(node); else if (ref) (ref as React.MutableRefObject<HTMLImageElement | null>).current = node;
        }}
        onLoad={(e) => { setLoaded(true); onLoad?.(e); }}
        onError={(e) => { setLoaded(true); onError?.(e); }}
        decoding={props.decoding ?? 'async'}
        loading={props.loading ?? 'lazy'}
        className={cn(
          'bg-muted transition-[filter,transform] duration-300 ease-enter motion-reduce:transition-none',
          loaded ? 'blur-0 scale-100' : 'scale-[1.04] blur-[12px] motion-reduce:blur-0 motion-reduce:scale-100',
          className,
        )}
      />
    );
  },
);
