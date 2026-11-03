/**
 * Print a PDF from the page, without leaving it: the blob goes into an off-screen iframe and its
 * print dialog opens. Where the browser will not print an iframe's PDF, the file opens in a new tab.
 */
export async function printPdfBlob(blob: Blob): Promise<void> {
  if (typeof window === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  // Not display:none: several browsers will not print a frame that is not rendered.
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  const cleanup = () => {
    iframe.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The PDF took too long to load.')), 15_000);
      iframe.onload = () => {
        clearTimeout(timer);
        try {
          const w = iframe.contentWindow;
          if (!w) throw new Error('No print window.');
          w.focus();
          w.print();
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      iframe.onerror = () => { clearTimeout(timer); reject(new Error('The PDF could not be loaded.')); };
      iframe.src = url;
      document.body.appendChild(iframe);
    });
    // The dialog is modal in most browsers; give it time before the frame goes.
    setTimeout(cleanup, 120_000);
  } catch (e) {
    iframe.remove();
    const tab = window.open(url, '_blank');
    if (!tab) {
      URL.revokeObjectURL(url);
      throw e instanceof Error ? e : new Error('Printing was blocked by the browser.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  }
}
