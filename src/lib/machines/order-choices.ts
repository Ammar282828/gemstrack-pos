/**
 * The statuses a person may pick for an order from where it is: the machine's `set` moves out of it, and the current one
 * (shown, not a move). A stored status the machine does not know (old data) is offered every state `check` lets it take.
 */
import { check } from './machine';
import { ORDER, ORDER_STATES, type OrderState } from './index';

export function orderStatusChoices(current: string, invoiced: boolean): OrderState[] {
  return ORDER_STATES.filter(s => s === current || (check(ORDER, current, s, 'set', { invoiced }).ok));
}
