import { describe, expect, it } from 'vitest';
import { moveRefusedBody, moveRefusedResponse } from './http';
import { MoveRefused, assertMove } from './machine';
import { ORDER } from './index';
import { orderStatusChoices } from './order-choices';

describe('a refused move over HTTP', () => {
  it('is 409 with the reason, the machine, from, to and what is allowed', async () => {
    let err: unknown;
    try { assertMove(ORDER, 'Completed', 'Pending', 'set', { invoiced: true }); } catch (e) { err = e; }
    const res = moveRefusedResponse(err)!;
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: expect.stringMatching(/undo the invoice first/), machine: 'Order', from: 'Completed', to: 'Pending' });
    expect(Array.isArray(body.allowed)).toBe(true);
    expect(moveRefusedBody(err as MoveRefused)).toEqual(body);
  });
  it('is null for any other error', () => {
    expect(moveRefusedResponse(new Error('x'))).toBeNull();
    expect(moveRefusedResponse(undefined)).toBeNull();
  });
});

describe('the statuses a person may pick for an order', () => {
  it('an open order offers the other open ones and Cancelled, never Refunded', () => {
    expect(orderStatusChoices('Pending', false)).toEqual(['Pending', 'In Progress', 'Completed', 'Cancelled']);
    expect(orderStatusChoices('Cancelled', false)).toEqual(['Pending', 'In Progress', 'Completed', 'Cancelled']);
  });
  it('an invoiced order shows only its own status; a Refunded one too', () => {
    expect(orderStatusChoices('Completed', true)).toEqual(['Completed']);
    expect(orderStatusChoices('Refunded', false)).toEqual(['Refunded']);
  });
  it('an old status the machine does not know still lists its own', () => {
    expect(orderStatusChoices('Delivered', false)).toEqual(['Pending', 'In Progress', 'Completed', 'Cancelled']);
  });
});
