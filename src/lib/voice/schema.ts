/**
 * The shape of the model's reply to one sentence (/api/voice/listen): the khata's own entry, or
 * \`steps\` for anything else and for several things at once (steps.ts). Vertex's own schema
 * dialect: uppercase type names.
 */

import { VOICE_ACTIONS } from './resolve';

export const READING_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: {
      type: 'STRING',
      description: 'What was actually said, in the script it was said in. Never cleaned up.',
    },
    action: {
      type: 'STRING',
      enum: [...VOICE_ACTIONS],
      description: 'Which of the shop\'s actions this sentence is.',
    },
    summary: {
      type: 'STRING',
      description: 'One short English sentence: what was recorded, who for, the figure. Or the question to ask.',
    },
    person: {
      type: 'OBJECT',
      description: 'Who this entry belongs to. Omit only for expense and other_income.',
      properties: {
        spoken_as: { type: 'STRING', description: 'The name exactly as it was heard, in Roman letters.' },
        name: { type: 'STRING', description: 'The roster name you believe that to be.' },
        kind: { type: 'STRING', enum: ['customer', 'karigar'] },
      },
    },
    for_customer: {
      type: 'STRING',
      description: 'A customer named as who the work is for, when that is somebody other than the person above.',
    },
    amount: { type: 'NUMBER', description: 'Rupees. The remainder after any part-payment, never the total.' },
    category: { type: 'STRING', description: 'For expense: its category, when said.' },
    steps: {
      type: 'ARRAY',
      description: 'For action "do": one line a step, in the order said: "command | name=value | name=value" (section 7).',
      items: { type: 'STRING' },
    },
    grams: { type: 'NUMBER', description: 'Weight in grams, for gold_received and gold_paid only.' },
    karat: { type: 'NUMBER', description: 'Purity, only when it was actually said.' },
    description: { type: 'STRING', description: 'What the entry was for, in his own words.' },
    screen: { type: 'STRING', description: 'For navigate: dashboard, customers, karigars, orders, products, hisaab, expenses, analytics, calendar, settings.' },
    query: { type: 'STRING', description: 'For ask: what is being asked about.' },
    doc: {
      type: 'OBJECT',
      description: 'The order or invoice, only when he said its number.',
      properties: {
        kind: { type: 'STRING', enum: ['order', 'invoice'] },
        id: { type: 'STRING', description: 'The number he said, as digits: "16".' },
      },
    },
    fields: {
      type: 'OBJECT',
      description: 'For new_/edit_ actions: the record fields being set, camelCase.',
      properties: {
        name: { type: 'STRING' },
        phone: { type: 'STRING' },
        altPhone: { type: 'STRING' },
        city: { type: 'STRING' },
        address: { type: 'STRING' },
        country: { type: 'STRING' },
        ringSize: { type: 'STRING' },
        bangleSize: { type: 'STRING' },
        braceletSize: { type: 'STRING' },
        chainLength: { type: 'STRING' },
        birthday: { type: 'STRING' },
        anniversary: { type: 'STRING' },
        preference: { type: 'STRING' },
        specialty: { type: 'STRING' },
        workshop: { type: 'STRING' },
        contact: { type: 'STRING' },
        notes: { type: 'STRING' },
        status: { type: 'STRING', description: 'For order_status: his word for the state of the work.' },
        date: { type: 'STRING', description: 'For order_promise: YYYY-MM-DD.' },
        method: { type: 'STRING', description: 'For invoice_payment: cash, card, bank transfer or cheque, if said.' },
      },
    },
  },
  required: ['action', 'summary'],
} as const;
