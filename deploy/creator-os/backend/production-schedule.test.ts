import assert from 'node:assert/strict';
import {nextProductionSlot} from './production-schedule.js';
const pick=(format:'short'|'standard',now:string,existing:Array<{publishAt?:string}>=[])=>
  nextProductionSlot(existing,format,new Date(now),'America/Mexico_City');
assert.equal(pick('short','2026-10-09T11:00:00Z'),'2026-10-09T12:00:00.000Z');
assert.equal(pick('standard','2026-10-09T11:00:00Z'),'2026-10-09T17:00:00.000Z');
assert.equal(pick('short','2026-10-09T17:00:00Z'),'2026-10-09T21:00:00.000Z');
assert.equal(pick('standard','2026-10-09T17:01:00Z'),'2026-10-10T17:00:00.000Z');
assert.equal(pick('short','2026-10-10T04:01:00Z'),'2026-10-10T12:00:00.000Z');
assert.equal(pick('short','2026-10-09T11:00:00Z',[{publishAt:'2026-10-09T12:00:00Z'}]),'2026-10-09T21:00:00.000Z');
assert.equal(pick('short','2026-10-09T11:58:00Z'),'2026-10-09T21:00:00.000Z');
console.log('PASS: seven Mexico City slot tests, formats, occupancy, midnight and cutoff');
