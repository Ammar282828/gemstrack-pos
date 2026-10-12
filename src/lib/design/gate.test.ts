import { describe, expect, it } from 'vitest';
import type { Role } from '@/lib/roles';
import { designAccess } from './gate';

const ask = (role: Role, need: 'post' | 'ads', o: { enabled?: boolean; open?: boolean; email?: string | null } = {}) =>
  designAccess({ enabled: o.enabled ?? true, open: o.open ?? false, email: o.email === undefined ? 'a@b.c' : o.email, role, need });

describe('who may use the Design routes', () => {
  it('lets owner, staff and marketing post; owner and marketing only do ads', () => {
    for (const r of ['owner', 'staff', 'marketing'] as Role[]) expect(ask(r, 'post'), r).toEqual({ who: 'a@b.c' });
    expect(ask('owner', 'ads')).toEqual({ who: 'a@b.c' });
    expect(ask('marketing', 'ads')).toEqual({ who: 'a@b.c' });
    expect(ask('staff', 'ads')).toMatchObject({ status: 403 });
  });
  it('refuses karigars and strangers, and the unsigned', () => {
    expect(ask('karigar', 'post')).toMatchObject({ status: 403 });
    expect(ask('none', 'post')).toMatchObject({ status: 403 });
    expect(ask('owner', 'post', { email: null })).toMatchObject({ status: 401 });
  });
  it('is nobody’s in a house without the feature', () => {
    expect(ask('owner', 'post', { enabled: false })).toMatchObject({ status: 404 });
    expect(ask('owner', 'post', { enabled: false, open: true })).toMatchObject({ status: 404 });
  });
  it('lets anyone in under open access', () => {
    expect(ask('none', 'ads', { open: true, email: null })).toEqual({ who: 'counter' });
  });
});
