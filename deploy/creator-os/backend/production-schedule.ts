export type ProductionFormat='short'|'standard';
const SLOTS={short:[6,15,22],standard:[11]};
function zonedParts(date:Date,timeZone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=(type:string)=>Number(parts.find(x=>x.type===type)?.value||0);
  return {year:get('year'),month:get('month'),day:get('day'),hour:get('hour'),minute:get('minute'),second:get('second')};
}
function toUtc(year:number,month:number,day:number,hour:number,timeZone:string){
  const requested=Date.UTC(year,month-1,day,hour,0,0);
  let guess=requested;
  for(let i=0;i<3;i++){
    const p=zonedParts(new Date(guess),timeZone);
    guess+=requested-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
  }
  return new Date(guess);
}
/** Reserve only a matching future slot. Never invent an off-schedule catch-up. */
export function nextProductionSlot(existing:Array<{publishAt?:string}>,format:ProductionFormat,
  now=new Date(),timeZone=process.env.SCHEDULE_TIMEZONE||'America/Mexico_City'){
  const local=zonedParts(now,timeZone);
  const occupied=new Set(existing.map(x=>x.publishAt).filter((x):x is string=>Boolean(x))
    .filter(x=>Number.isFinite(Date.parse(x))).map(x=>new Date(x).toISOString()));
  for(let day=0;day<32;day++){
    const date=new Date(Date.UTC(local.year,local.month-1,local.day+day,12));
    const parts=zonedParts(date,timeZone);
    for(const hour of SLOTS[format]){
      const candidate=toUtc(parts.year,parts.month,parts.day,hour,timeZone);
      if(candidate.getTime()<now.getTime()+5*60_000)continue;
      if(!occupied.has(candidate.toISOString()))return candidate.toISOString();
    }
  }
  throw new Error(`No free ${format} production slot within 32 days`);
}
