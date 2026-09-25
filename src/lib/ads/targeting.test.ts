import { describe, expect, it } from 'vitest';
import { buildTargeting, defaultDraft, describeAudience, mergeTargeting, parseTargeting, type AudienceDraft } from './targeting';

const draft = (over: Partial<AudienceDraft> = {}): AudienceDraft => ({ ...defaultDraft(), ...over });

describe('buildTargeting', () => {
  it('always states Advantage+ audience outright (Meta refuses targeting without it)', () => {
    expect(buildTargeting(draft({ advantage: false })).targeting_automation).toEqual({ advantage_audience: 0 });
    expect(buildTargeting(draft({ advantage: true })).targeting_automation).toEqual({ advantage_audience: 1 });
  });
  it('with Advantage+, the maximum age is 65 and only a minimum up to 25 is firm; the ages asked for become the suggestion', () => {
    const t = buildTargeting(draft({ advantage: true, ageMin: 30, ageMax: 50 }));
    expect(t).toMatchObject({ age_min: 25, age_max: 65, age_range: [30, 50] });
  });
  it('without Advantage+, the ages are strict', () => {
    const t = buildTargeting(draft({ advantage: false, ageMin: 30, ageMax: 50 }));
    expect(t).toMatchObject({ age_min: 30, age_max: 50 });
    expect(t).not.toHaveProperty('age_range');
  });
  it('places: countries, cities with a radius in km (clamped to Meta’s 17–80), pins', () => {
    const t = buildTargeting(draft({
      places: [
        { type: 'country', key: 'AE', name: 'UAE' },
        { type: 'city', key: '2514815', name: 'Karachi', radiusKm: 5 },
        { type: 'city', key: '2511637', name: 'Lahore' },
        { type: 'region', key: '3345', name: 'Sindh' },
        { type: 'pin', lat: 24.86, lng: 67.01, radiusKm: 200, name: 'Around the shop' },
      ],
    }));
    expect(t.geo_locations).toEqual({
      countries: ['AE'],
      cities: [{ key: '2514815', radius: 17, distance_unit: 'kilometer' }, { key: '2511637' }],
      regions: [{ key: '3345' }],
      custom_locations: [{ latitude: 24.86, longitude: 67.01, radius: 80, distance_unit: 'kilometer', name: 'Around the shop' }],
      location_types: ['home', 'recent'],
    });
  });
  it('falls back to Pakistan with no places', () => {
    expect((buildTargeting(draft({ places: [] })).geo_locations as Record<string, unknown>).countries).toEqual(['PK']);
  });
  it('gender, interests and the shop’s audiences', () => {
    const t = buildTargeting(draft({ gender: 'women', interests: [{ id: '6003', name: 'Jewellery' }], include: [{ id: 'A1', name: 'Buyers' }], exclude: [{ id: 'A2', name: 'Recent' }] }));
    expect(t.genders).toEqual([2]);
    expect(t.flexible_spec).toEqual([{ interests: [{ id: '6003', name: 'Jewellery' }] }]);
    expect(t.custom_audiences).toEqual([{ id: 'A1' }]);
    expect(t.excluded_custom_audiences).toEqual([{ id: 'A2' }]);
  });
  it('placements: Instagram only by hand, never Explore (Meta refuses it from v26); automatic says nothing', () => {
    const ig = buildTargeting(draft({ placements: 'instagram', igPositions: ['stream', 'explore', 'reels'] }));
    expect(ig.publisher_platforms).toEqual(['instagram']);
    expect(ig.instagram_positions).toEqual(['stream', 'reels']);
    const both = buildTargeting(draft({ placements: 'instagram_facebook' }));
    expect(both.publisher_platforms).toEqual(['instagram', 'facebook']);
    expect(both.facebook_positions).toBeDefined();
    const auto = buildTargeting(draft({ placements: 'auto' }));
    expect(auto).not.toHaveProperty('publisher_platforms');
    expect(auto).not.toHaveProperty('instagram_positions');
  });
});

describe('mergeTargeting', () => {
  it('replaces what the editor controls and keeps the rest of Meta’s targeting', () => {
    const existing = {
      geo_locations: { countries: ['PK'] }, age_min: 18, age_max: 65, locales: [6],
      flexible_spec: [{ interests: [{ id: 'old', name: 'Old' }], behaviors: [{ id: 'b1', name: 'Frequent travellers' }] }],
      publisher_platforms: ['facebook'], facebook_positions: ['feed'], excluded_geo_locations: { countries: ['IN'] },
    };
    const built = buildTargeting(draft({ advantage: false, placements: 'auto', interests: [{ id: 'new', name: 'Gold' }] }));
    const out = mergeTargeting(existing, built);
    expect(out.locales).toEqual([6]);
    expect(out.excluded_geo_locations).toEqual({ countries: ['IN'] });
    expect(out.flexible_spec).toEqual([{ interests: [{ id: 'new', name: 'Gold' }] }, { behaviors: [{ id: 'b1', name: 'Frequent travellers' }] }]);
    expect(out).not.toHaveProperty('publisher_platforms');
    expect(out).not.toHaveProperty('facebook_positions');
    expect(out.targeting_automation).toEqual({ advantage_audience: 0 });
  });
});

describe('parseTargeting', () => {
  it('reads Meta’s targeting back into what the editor shows', () => {
    const d = parseTargeting({
      geo_locations: { countries: ['PK'], cities: [{ key: '1', name: 'Karachi', region: 'Sindh', country: 'PK', radius: 25, distance_unit: 'mile' }], custom_locations: [{ latitude: 24.8, longitude: 67, radius: 5, distance_unit: 'kilometer' }] },
      age_min: 25, age_max: 65, age_range: [28, 45], genders: [1],
      flexible_spec: [{ interests: [{ id: 'i', name: 'Gold' }] }],
      custom_audiences: [{ id: 'a', name: 'Buyers' }],
      targeting_automation: { advantage_audience: 1 },
      publisher_platforms: ['instagram'], instagram_positions: ['stream', 'explore'],
    });
    expect(d.places).toEqual([
      { type: 'country', key: 'PK', name: 'Pakistan' },
      { type: 'city', key: '1', name: 'Karachi', detail: 'Sindh, PK', radiusKm: 40 },
      { type: 'pin', lat: 24.8, lng: 67, radiusKm: 5, name: '24.800, 67.000' },
    ]);
    expect([d.ageMin, d.ageMax, d.gender, d.advantage, d.placements]).toEqual([28, 45, 'men', true, 'instagram']);
    expect(d.igPositions).toEqual(['stream']);
    expect(d.interests).toEqual([{ id: 'i', name: 'Gold' }]);
    expect(d.include).toEqual([{ id: 'a', name: 'Buyers' }]);
  });
  it('round-trips a draft', () => {
    const d = draft({ advantage: false, ageMin: 22, ageMax: 40, gender: 'women', placements: 'instagram', igPositions: ['story'] });
    const back = parseTargeting(buildTargeting(d));
    expect([back.ageMin, back.ageMax, back.gender, back.advantage, back.placements, back.igPositions]).toEqual([22, 40, 'women', false, 'instagram', ['story']]);
  });
});

describe('describeAudience', () => {
  it('reads as one line', () => {
    expect(describeAudience(draft({ places: [{ type: 'city', key: '1', name: 'Karachi', radiusKm: 25 }], ageMin: 22, ageMax: 65, gender: 'women', interests: [{ id: '1', name: 'Gold' }] })))
      .toBe('Karachi +25 km · 22–65+ · women · Gold · Advantage+ · Instagram only');
  });
});
