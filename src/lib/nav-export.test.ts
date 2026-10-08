import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { houseEnv } from '../../scripts/nav-export.mjs';

// The native iPhone app draws its menus from these files (apps/iphone): a change to lib/nav.ts that
// is not exported again would leave the app without the new place. `npm run nav:export` fixes this.
describe('the iPhone app has the ERP\'s whole map', () => {
  for (const house of ['taheri', 'mina']) {
    it(`nav-${house}.json is current`, () => {
      const fresh = execFileSync('npx', ['tsx', 'scripts/nav-export.mjs', house], {
        env: { ...process.env, ...houseEnv(house), NODE_ENV: 'production' }, encoding: 'utf8',
      });
      expect(JSON.parse(fs.readFileSync(`apps/iphone/App/Resources/nav-${house}.json`, 'utf8'))).toEqual(JSON.parse(fresh));
    }, 60_000);
  }
});
