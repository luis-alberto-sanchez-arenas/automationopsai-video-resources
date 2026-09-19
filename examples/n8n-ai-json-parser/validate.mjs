export function validate(value) {
  const errors=[];
  if(!value||typeof value!=='object'||Array.isArray(value)) return {valid:false,errors:['Expected a JSON object']};
  const keys=['leadId','email','intent','confidence','crmAction'];
  for(const k of keys) if(!Object.hasOwn(value,k))errors.push(`Missing field: ${k}`);
  for(const k of Object.keys(value)) if(!keys.includes(k))errors.push(`Unexpected field: ${k}`);
  if(typeof value.leadId!=='string'||!value.leadId.trim())errors.push('leadId must be nonempty');
  if(typeof value.email!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))errors.push('Invalid email shape');
  if(!['sales','support','unknown'].includes(value.intent))errors.push('Invalid intent');
  if(typeof value.confidence!=='number'||!Number.isFinite(value.confidence)||value.confidence<0||value.confidence>1)errors.push('confidence must be a number in [0,1]');
  if(!['create','review','reject'].includes(value.crmAction))errors.push('Invalid crmAction');
  return errors.length?{valid:false,errors}:{valid:true,data:value};
}
export function parseAndValidate(raw) {
  let value=raw;
  if(typeof raw==='string') {try {value=JSON.parse(raw);}catch {return {valid:false,errors:['Malformed JSON']};}}
  return validate(value);
}
