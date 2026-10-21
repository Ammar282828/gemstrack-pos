/**
 * A tool's zod input as JSON Schema, for MCP's `inputSchema` and the OpenAPI document (the repo has zod 3,
 * which has no converter of its own). Covers what the agent's tools use — objects, strings (enums, lengths,
 * patterns), numbers (int, min, max), booleans, arrays, literals, unions of literals, records, and the
 * optional / nullable / default / describe wrappers. Anything else becomes `{}` (any), never a throw. Pure.
 */

import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

const withDesc = (s: JsonSchema, t: z.ZodTypeAny): JsonSchema => (t.description ? { ...s, description: t.description } : s);

export function toJsonSchema(t: z.ZodTypeAny): JsonSchema {
  const def = t._def as { typeName?: string } & Record<string, unknown>;
  switch (def.typeName) {
    case z.ZodFirstPartyTypeKind.ZodOptional:
    case z.ZodFirstPartyTypeKind.ZodNullable: {
      const inner = toJsonSchema((t as z.ZodOptional<z.ZodTypeAny>).unwrap());
      return withDesc(def.typeName === z.ZodFirstPartyTypeKind.ZodNullable ? { anyOf: [inner, { type: 'null' }] } : inner, t);
    }
    case z.ZodFirstPartyTypeKind.ZodDefault: {
      const d = t as z.ZodDefault<z.ZodTypeAny>;
      return withDesc({ ...toJsonSchema(d.removeDefault()), default: d._def.defaultValue() }, t);
    }
    case z.ZodFirstPartyTypeKind.ZodEffects:
      return withDesc(toJsonSchema((t as z.ZodEffects<z.ZodTypeAny>).innerType()), t);
    case z.ZodFirstPartyTypeKind.ZodString: {
      const s: JsonSchema = { type: 'string' };
      for (const c of (t as z.ZodString)._def.checks) {
        if (c.kind === 'min') s.minLength = c.value;
        if (c.kind === 'max') s.maxLength = c.value;
        if (c.kind === 'regex') s.pattern = c.regex.source;
        if (c.kind === 'datetime') s.format = 'date-time';
      }
      return withDesc(s, t);
    }
    case z.ZodFirstPartyTypeKind.ZodNumber: {
      const s: JsonSchema = { type: 'number' };
      for (const c of (t as z.ZodNumber)._def.checks) {
        if (c.kind === 'int') s.type = 'integer';
        if (c.kind === 'min') s[c.inclusive ? 'minimum' : 'exclusiveMinimum'] = c.value;
        if (c.kind === 'max') s[c.inclusive ? 'maximum' : 'exclusiveMaximum'] = c.value;
      }
      return withDesc(s, t);
    }
    case z.ZodFirstPartyTypeKind.ZodBoolean: return withDesc({ type: 'boolean' }, t);
    case z.ZodFirstPartyTypeKind.ZodLiteral: {
      const v = (t as z.ZodLiteral<unknown>).value;
      return withDesc({ type: typeof v, const: v }, t);
    }
    case z.ZodFirstPartyTypeKind.ZodEnum:
      return withDesc({ type: 'string', enum: [...(t as z.ZodEnum<[string, ...string[]]>).options] }, t);
    case z.ZodFirstPartyTypeKind.ZodArray: {
      const a = t as z.ZodArray<z.ZodTypeAny>;
      const s: JsonSchema = { type: 'array', items: toJsonSchema(a.element) };
      if (a._def.minLength) s.minItems = a._def.minLength.value;
      if (a._def.maxLength) s.maxItems = a._def.maxLength.value;
      return withDesc(s, t);
    }
    case z.ZodFirstPartyTypeKind.ZodObject: {
      const shape = (t as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [k, v] of Object.entries(shape)) {
        properties[k] = toJsonSchema(v as z.ZodTypeAny);
        if (!(v as z.ZodTypeAny).isOptional()) required.push(k);
      }
      const passthrough = (t as z.ZodObject<z.ZodRawShape>)._def.unknownKeys === 'passthrough';
      return withDesc({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: passthrough }, t);
    }
    case z.ZodFirstPartyTypeKind.ZodRecord:
      return withDesc({ type: 'object', additionalProperties: toJsonSchema((t as z.ZodRecord).valueSchema) }, t);
    case z.ZodFirstPartyTypeKind.ZodUnion: {
      const opts = (t as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>).options.map(toJsonSchema);
      return withDesc({ anyOf: opts }, t);
    }
    default:
      return withDesc({}, t);
  }
}
