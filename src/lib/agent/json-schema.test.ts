import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toJsonSchema } from './json-schema';

describe('zod to JSON Schema', () => {
  it('draws objects, required keys, limits, enums, defaults and descriptions', () => {
    const s = toJsonSchema(z.object({
      name: z.string().min(1).max(60).describe('Its name.'),
      n: z.number().int().min(1).max(40).optional(),
      kind: z.enum(['a', 'b']).default('a'),
      tags: z.array(z.string()).max(3),
      on: z.boolean().nullable(),
    }));
    expect(s).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 60, description: 'Its name.' },
        n: { type: 'integer', minimum: 1, maximum: 40 },
        kind: { type: 'string', enum: ['a', 'b'], default: 'a' },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        on: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
      },
      required: ['name', 'tags', 'on'],
      additionalProperties: false,
    });
  });

  it('keeps a pattern, a record and an empty object', () => {
    expect(toJsonSchema(z.string().regex(/^\d{4}$/))).toEqual({ type: 'string', pattern: '^\\d{4}$' });
    expect(toJsonSchema(z.record(z.number()))).toEqual({ type: 'object', additionalProperties: { type: 'number' } });
    expect(toJsonSchema(z.object({}))).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });
});
