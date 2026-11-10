// npm run machines:export — the state machines (src/lib/machines) as apps/iphone/App/Resources/machines.json (the iPhone,
// the Mac and Android read it) and docs/state-machines.md. machines.test.ts fails when either is stale.
import fs from 'node:fs';
import { machinesJsonText, machinesMarkdown } from '../src/lib/machines/export';

fs.writeFileSync('apps/iphone/App/Resources/machines.json', machinesJsonText());
fs.writeFileSync('docs/state-machines.md', machinesMarkdown());
console.log('wrote apps/iphone/App/Resources/machines.json and docs/state-machines.md');
