/**
 * Turning a stored document into what staff are allowed to receive.
 *
 * Kept apart from the route that serves it so it can be tested directly — this
 * is the whole of the boundary, and a boundary nobody can run assertions
 * against is a boundary nobody can trust.
 */

import { STAFF_HIDDEN_FIELDS, STAFF_HIDDEN_ITEM_FIELDS, STAFF_SETTINGS_FIELDS } from './roles';

type Doc = Record<string, unknown>;

const strip = (doc: Doc, fields: readonly string[]): Doc => {
  const out: Doc = {};
  for (const [k, v] of Object.entries(doc)) if (!fields.includes(k)) out[k] = v;
  return out;
};

/**
 * One document, filtered for a given collection.
 *
 * Deliberately allow-nothing-by-accident: the item arrays inside orders and
 * invoices are walked too. Stripping only the top level would have left the
 * cost of every line sitting inside `items`, which is where it actually lives.
 */
export function staffView(collection: string, doc: Doc): Doc {
  const hidden = [
    ...(STAFF_HIDDEN_FIELDS['*'] ?? []),
    ...(STAFF_HIDDEN_FIELDS[collection] ?? []),
  ];
  const out = strip(doc, hidden);

  if (Array.isArray(out.items)) {
    out.items = (out.items as unknown[]).map(item =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? strip(item as Doc, STAFF_HIDDEN_ITEM_FIELDS)
        : item,
    );
  }

  return out;
}

export const staffViewAll = (collection: string, docs: Doc[]): Doc[] =>
  docs.map(d => staffView(collection, d));

/** Settings, reduced to the allow-list. */
export function staffSettingsView(doc: Doc): Doc {
  const out: Doc = {};
  for (const k of STAFF_SETTINGS_FIELDS) if (k in doc) out[k] = doc[k];
  return out;
}
