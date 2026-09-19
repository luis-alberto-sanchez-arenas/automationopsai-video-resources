import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {parseAndValidate} from './validate.mjs';
const valid=JSON.parse(readFileSync(new URL('./payloads/valid.json',import.meta.url),'utf8'));
const invalid=JSON.parse(readFileSync(new URL('./payloads/malformed.json',import.meta.url),'utf8'));
const cases=[['valid',valid,true],['invalid contract',invalid,false],['bad JSON','{"leadId":',false],['array',[],false],['null',null,false],['numeric string',{...valid,confidence:'0.93'},false],['extra key',{...valid,extra:1},false],['missing key',Object.fromEntries(Object.entries(valid).filter(([k])=>k!=='email')),false],['lower bound',{...valid,confidence:0},true],['upper bound',{...valid,confidence:1},true]];
for(const [name,input,expected] of cases) {assert.equal(parseAndValidate(input).valid,expected,name);console.log(`PASS ${name}`);}
console.log(`${cases.length} cases passed`);
