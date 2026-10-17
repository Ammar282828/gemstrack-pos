/**
 * Which calendar a document's days are read on. The browser's is its own clock (deviceWall); the
 * server's clock is UTC, so a report it draws reads Karachi's (karachiWall), or an expense typed at
 * 1 a.m. would sit in yesterday's bucket and "This month" would start five hours late.
 *
 * A wall clock turns an instant into a Date whose local fields (what date-fns' startOfMonth,
 * startOfDay and format read) are that calendar's day and hour, so the pages' own date-fns code
 * gives the shop's days on any host.
 */

export type WallClock = (d: Date) => Date;

/** The browser: its own clock, as the pages always read it. */
export const deviceWall: WallClock = (d) => d;

const KARACHI_MS = 5 * 3_600_000; // UTC+5, no daylight saving

export const karachiWall: WallClock = (d) => new Date(d.getTime() + KARACHI_MS + d.getTimezoneOffset() * 60_000);
