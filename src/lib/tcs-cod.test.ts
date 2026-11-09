import { describe, expect, it } from 'vitest';
import {
  buildCreateOrder, cnFromReply, courierTime, matchCity, normaliseTcsTrack, parseCities, parsePaymentDetails,
  replyShape, returnStatusOf, stateOfText, tcsMobile, tcsRefusal, tcsTrackUrl,
} from './tcs-cod';
import type { TcsCredentials } from './tcs-payments';

const ACCOUNT: TcsCredentials = { clientId: 'cid', username: 'hom', password: 'pw', costCenterCode: 'KHI-01', accountNo: '123456', originCity: 'Karachi' };
const INPUT = {
  consignee: { name: 'Ayesha Khan', address: 'House 12, Street 4, DHA Phase 5', mobile: '+92 300 1234567', email: 'a@b.pk' },
  destinationCity: 'Lahore', weight: 0.5, pieces: 1, codAmount: 12499.6, reference: '#1460',
};

describe('buildCreateOrder', () => {
  it('writes the portal’s body: text COD, local mobile, overnight, fragile', () => {
    const r = buildCreateOrder(ACCOUNT, INPUT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.payload).toEqual({
      userName: 'hom', password: 'pw', costCenterCode: 'KHI-01',
      consigneeName: 'Ayesha Khan', consigneeAddress: 'House 12, Street 4, DHA Phase 5', consigneeMobNo: '03001234567', consigneeEmail: 'a@b.pk',
      originCityName: 'Karachi', destinationCityName: 'Lahore', weight: 0.5, pieces: 1, codAmount: '12500',
      customerReferenceNo: '#1460', services: 'O', productDetails: 'Jewellery', fragile: 'Yes', remarks: '', insuranceValue: 0,
    });
  });
  it('refuses what TCS would refuse, in plain words', () => {
    expect(buildCreateOrder(ACCOUNT, { ...INPUT, consignee: { ...INPUT.consignee, address: '' } })).toMatchObject({ ok: false, error: /address/ });
    expect(buildCreateOrder(ACCOUNT, { ...INPUT, consignee: { ...INPUT.consignee, mobile: '123' } })).toMatchObject({ ok: false, error: /mobile/ });
    expect(buildCreateOrder(ACCOUNT, { ...INPUT, weight: 0 })).toMatchObject({ ok: false, error: /weight/ });
    expect(buildCreateOrder(ACCOUNT, { ...INPUT, destinationCity: ' ' })).toMatchObject({ ok: false, error: /city/ });
    expect(buildCreateOrder(ACCOUNT, { ...INPUT, codAmount: -1 })).toMatchObject({ ok: false, error: /cash/ });
  });
  it('drops a bad email, says No when not fragile, sends from the account’s city', () => {
    const r = buildCreateOrder({ ...ACCOUNT, originCity: 'Lahore' }, { ...INPUT, fragile: false, consignee: { ...INPUT.consignee, email: 'nope' } });
    expect(r.ok && r.payload).toMatchObject({ fragile: 'No', consigneeEmail: '', originCityName: 'Lahore' });
  });
});

describe('tcsMobile', () => {
  it('puts Pakistani numbers in the local form', () => {
    expect(tcsMobile('+92 300 1234567')).toBe('03001234567');
    expect(tcsMobile('923001234567')).toBe('03001234567');
    expect(tcsMobile('0300-1234567')).toBe('03001234567');
    expect(tcsMobile('3001234567')).toBe('03001234567');
    expect(tcsMobile('00923001234567')).toBe('03001234567');
  });
});

describe('returnStatus and refusals', () => {
  it('reads returnStatus in any casing', () => {
    expect(returnStatusOf({ returnStatus: { code: '0200', status: 'SUCCESS', message: 'ok' } })).toMatchObject({ ok: true, code: '0200' });
    expect(returnStatusOf({ ReturnStatus: { Code: '0400', Status: 'FAIL', Message: 'Invalid city' } })).toMatchObject({ ok: false, message: 'Invalid city' });
  });
  it('reads the gateway’s 401 and says what it means', () => {
    const gw = { httpCode: '401', httpMessage: 'Unauthorized', moreInformation: 'You are not authorized to call this API' };
    expect(returnStatusOf(gw)).toMatchObject({ ok: false, code: '401' });
    expect(tcsRefusal(gw, 401)).toMatch(/not opened this account/);
    expect(tcsRefusal({ returnStatus: { code: '0400', status: 'FAIL', message: 'Invalid destination' } }, 200)).toBe('TCS said: Invalid destination (0400)');
  });
});

describe('cnFromReply', () => {
  const ok = { code: '0200', status: 'SUCCESS', message: '' };
  it('finds the number wherever TCS puts it', () => {
    expect(cnFromReply({ returnStatus: ok, bookingReply: { result: '779412345678' } })).toBe('779412345678');
    expect(cnFromReply({ returnStatus: ok, consignmentNo: 779412345678 })).toBe('779412345678');
    expect(cnFromReply({ returnStatus: ok, data: [{ CN: '779412345678' }] })).toBe('779412345678');
    expect(cnFromReply({ returnStatus: { ...ok, message: 'Order created successfully. CN: 779412345678' } })).toBe('779412345678');
  });
  it('null when there is none', () => {
    expect(cnFromReply({ returnStatus: ok, bookingReply: { result: 'Saved' } })).toBeNull();
  });
  it('outlines a reply without its values', () => {
    expect(replyShape({ returnStatus: ok, bookingReply: { result: '7794' }, list: [{ a: 1 }] })).toEqual({
      returnStatus: { code: 'string', status: 'string', message: 'string' }, bookingReply: { result: 'string' }, list: [{ a: 'number' }],
    });
  });
});

describe('cities', () => {
  it('reads the list whatever it is called', () => {
    expect(parseCities({ returnStatus: { code: '0200' }, allCities: [{ cityID: 1, cityName: 'Lahore' }, { cityID: 2, cityName: 'Karachi' }, { cityName: 'Lahore' }] })).toEqual(['Karachi', 'Lahore']);
    expect(parseCities({ cities: ['Multan', 'Quetta'] })).toEqual(['Multan', 'Quetta']);
  });
  it('matches a typed city loosely', () => {
    expect(matchCity(' karachi ', ['Karachi', 'Lahore'])).toBe('Karachi');
    expect(matchCity('Dera Ghazi-Khan', ['DERA GHAZI KHAN'])).toBe('DERA GHAZI KHAN');
    expect(matchCity('Nowhere', ['Karachi'])).toBe('Nowhere');
  });
});

describe('courierTime', () => {
  it('reads TCS’s ways of writing a time, on Karachi’s clock', () => {
    expect(courierTime('2026-11-09 14:05:00')).toBe('2026-11-09T09:05:00.000Z');
    expect(courierTime('09/11/2026 2:05 PM')).toBe('2026-11-09T09:05:00.000Z');
    expect(courierTime('Monday Nov 09, 2026 14:05')).toBe('2026-11-09T09:05:00.000Z');
    expect(courierTime('09-Nov-2026 14:05')).toBe('2026-11-09T09:05:00.000Z');
    expect(courierTime('2026-11-09T14:05:00+05:00')).toBe('2026-11-09T09:05:00.000Z');
    expect(courierTime('soon')).toBe('soon');
  });
});

describe('stateOfText', () => {
  it('reads a scan as a state', () => {
    expect(stateOfText('Shipment Delivered')).toBe('delivered');
    expect(stateOfText('OK')).toBe('delivered');
    expect(stateOfText('Out For Delivery')).toBe('out_for_delivery');
    expect(stateOfText('Delivery attempted - consignee not available')).toBe('attempted');
    expect(stateOfText('Return to origin')).toBe('returned');
    expect(stateOfText('Arrived at TCS facility')).toBe('in_transit');
    expect(stateOfText('Booked')).toBe('booked');
    expect(stateOfText('Something')).toBeNull();
  });
});

describe('normaliseTcsTrack', () => {
  it('reads checkpoints and delivery info, newest first, without repeats', () => {
    const reply = {
      returnStatus: { code: '0200', status: 'SUCCESS', message: '' },
      TrackDetailReply: {
        TrackInfo: [{ consignmentNo: '779412345678', origin: 'KARACHI', destination: 'LAHORE' }],
        Checkpoints: [
          { recievedBy: '', dateTime: '2026-11-08 18:00:00', status: 'Booked', location: 'KARACHI' },
          { recievedBy: '', dateTime: '2026-11-09 08:10:00', status: 'Arrived at TCS Facility', location: 'LAHORE' },
          { recievedBy: '', dateTime: '2026-11-09 10:00:00', status: 'Out For Delivery', location: 'LAHORE' },
          { recievedBy: 'Ayesha Khan', dateTime: '2026-11-09 14:05:00', status: 'Delivered', location: 'LAHORE' },
        ],
        DeliveryInfo: [{ recievedBy: 'Ayesha Khan', dateTime: '2026-11-09 14:05:00', status: 'Delivered' }],
      },
    };
    const t = normaliseTcsTrack(reply)!;
    expect(t.state).toBe('delivered');
    expect(t.status).toBe('Delivered');
    expect(t.deliveredAt).toBe('2026-11-09T09:05:00.000Z');
    expect(t.receivedBy).toBe('Ayesha Khan');
    expect(t.events.map(e => e.status)).toEqual(['Delivered', 'Out For Delivery', 'Arrived at TCS Facility', 'Booked']);
    expect(t.events[1]).toEqual({ at: '2026-11-09T05:00:00.000Z', status: 'Out For Delivery', location: 'LAHORE' });
  });
  it('null when TCS has no scans', () => {
    expect(normaliseTcsTrack({ returnStatus: { code: '0200' }, TrackDetailReply: { Checkpoints: [] } })).toBeNull();
  });
  it('in transit once there is more than the booking, though no line says so', () => {
    const t = normaliseTcsTrack({ history: [{ date: '2026-11-09 10:00', description: 'Booked' }, { date: '2026-11-09 12:00', description: 'Loaded on vehicle' }] })!;
    expect(t.state).toBe('in_transit');
  });
});

describe('payment details', () => {
  it('reads whether TCS paid out the cash', () => {
    expect(parsePaymentDetails({ returnStatus: { code: '0200' }, paymentDetail: [{ paymentStatus: 'Y', amountPaid: '12,500', paymentDate: '20/11/2026', invoiceNo: 'INV-77' }] }))
      .toEqual({ paid: true, amount: 12500, paidOn: '2026-11-19T19:00:00.000Z', invoiceNumber: 'INV-77' });
    expect(parsePaymentDetails({ returnStatus: { code: '0200' } })).toBeNull();
  });
});

it('links TCS’s tracking page', () => {
  expect(tcsTrackUrl('779412345678')).toBe('https://www.tcsexpress.com/track/779412345678');
});
