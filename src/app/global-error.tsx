'use client';

/**
 * Last resort. This replaces the root layout, so it fires only when the layout
 * itself throws — the store provider, the theme resolver, the auth gate. By
 * then nothing from the app can be trusted: not the CSS variables, not the
 * component library, not the fonts.
 *
 * So it renders its own <html> and <body> (Next requires it here) and styles
 * itself inline, depending on nothing but the browser. Deliberately plain: if
 * this screen is showing, the useful thing is a reload button and a reference
 * code, not branding.
 *
 * In development Next shows its own overlay instead, so this is a production
 * path you will not see locally.
 */

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error('[GemsTrack] global error', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: '#f6f6f7',
          color: '#18181b',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '28rem',
            background: '#fff',
            border: '1px solid #e4e4e7',
            borderRadius: '0.75rem',
            padding: '1.75rem',
            boxShadow: '0 10px 30px -12px rgba(0,0,0,0.18)',
          }}
        >
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.125rem', fontWeight: 650 }}>
            The app could not start
          </h1>
          <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', lineHeight: 1.55, color: '#52525b' }}>
            Something failed before any page could load. Your saved records are not affected.
            Reload to try again; if it keeps happening, check the internet connection first.
          </p>

          <button
            onClick={reset}
            style={{
              width: '100%',
              padding: '0.625rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              fontFamily: 'inherit',
              color: '#fff',
              background: '#18181b',
              border: 0,
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Reload the app
          </button>

          {error.digest && (
            <p style={{ margin: '1rem 0 0', fontSize: '0.75rem', color: '#71717a' }}>
              Reference for support:{' '}
              <code style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {error.digest}
              </code>
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
