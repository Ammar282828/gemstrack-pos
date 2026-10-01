import { describe, it, expect } from 'vitest';
import { chromeIntent, embeddedBrowser, signInAdvice } from './sign-in-trouble';

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
  webviewAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-A146B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.0.0 Mobile Safari/537.36',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0 Mobile Safari/537.36 Instagram 345.0.0.0 Android',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0;FBBV/1]',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.98 Mobile/15E148 Safari/604.1',
  webviewIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

describe('embeddedBrowser', () => {
  it('lets real browsers through', () => {
    for (const ua of [UA.chromeAndroid, UA.safariIos, UA.chromeIos, UA.desktop, '']) expect(embeddedBrowser(ua)).toBeNull();
  });
  it('names the app when it says who it is', () => {
    expect(embeddedBrowser(UA.instagramAndroid)).toEqual({ app: 'Instagram', platform: 'android' });
    expect(embeddedBrowser(UA.facebookIos)).toEqual({ app: 'Facebook', platform: 'ios' });
  });
  it('catches an unnamed WebView by its kind', () => {
    expect(embeddedBrowser(UA.webviewAndroid)).toEqual({ app: 'this app', platform: 'android' });
    expect(embeddedBrowser(UA.webviewIos)).toEqual({ app: 'this app', platform: 'ios' });
  });
});

describe('chromeIntent', () => {
  it('opens the same page in Chrome, with the page itself as the fallback', () => {
    const i = chromeIntent('https://erp.houseofmina.store/my-work?x=1');
    expect(i.startsWith('intent://erp.houseofmina.store/my-work?x=1#Intent;scheme=https;package=com.android.chrome;')).toBe(true);
    expect(i).toContain(`S.browser_fallback_url=${encodeURIComponent('https://erp.houseofmina.store/my-work?x=1')}`);
  });
});

describe('signInAdvice', () => {
  it('says nothing when the person closed the window', () => {
    expect(signInAdvice('auth/popup-closed-by-user', null)).toBeNull();
  });
  it('sends an in-app browser to the real one', () => {
    expect(signInAdvice('auth/operation-not-supported-in-this-environment', { app: 'Instagram', platform: 'ios' })).toContain('Safari');
    expect(signInAdvice('auth/internal-error', { app: 'this app', platform: 'android' })).toContain('Chrome');
  });
  it('names a blocked pop-up and an unknown code', () => {
    expect(signInAdvice('auth/popup-blocked', null)).toMatch(/pop-ups/);
    expect(signInAdvice('auth/internal-error', null)).toContain('internal-error');
  });
});
