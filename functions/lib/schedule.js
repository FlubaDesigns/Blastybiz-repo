// Canonical browser/server recurrence rules. public/schedule-utils.js is generated.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BBSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const slots = { morning: 9, midday: 12, afternoon: 15, evening: 18 };
  const frequencies = ['once', 'weekly', 'biweekly', 'monthly', 'quarterly', 'daily'];
  function normalizeSchedule(input = {}) {
    const s = { ...input, frequency: input.frequency || 'weekly', timezone: input.timezone || 'America/New_York', timeSlot: input.timeSlot || 'morning' };
    if (!frequencies.includes(s.frequency) || (['once','biweekly','quarterly'].includes(s.frequency)&&!s.firstRunAtUtc)) {
      s.enabled = false;
      s.unsupportedFrequency = s.frequency;
    } else { delete s.unsupportedFrequency; }
    return s;
  }
  function localParts(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:timezone, year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hourCycle:'h23'}).formatToParts(date);
    const p = Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
    return p;
  }
  function wallTime(year, month, day, hour, timezone, minute = 0) {
    const target = Date.UTC(year,month,day,hour,minute);
    let value = target;
    for(let i=0;i<5;i++) {
      const p=localParts(new Date(value),timezone);
      const delta=target-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
      if(!delta)return new Date(value);
      value+=delta;
    }
    // Do not silently schedule on a different local date if that date did not exist.
    throw new Error('This local posting time is unavailable in the selected timezone.');
  }
  function computeNextRunAt(input, after = new Date()) {
    const s=normalizeSchedule(input), now=new Date(after);
    if(s.unsupportedFrequency)throw new Error('Choose a supported recurrence before enabling this schedule.');
    if(s.firstRunAtUtc)return nextCanonical(s,now);
    if(!Number.isFinite(now.getTime()) || !(s.timeSlot in slots))throw new Error('Invalid posting time.');
    const p=localParts(now,s.timezone), hour=slots[s.timeSlot];
    const dow=Number(s.dayOfWeek ?? 1), dom=Number(s.dayOfMonth ?? 1);
    if(s.frequency==='weekly'&&(!Number.isInteger(dow)||dow<0||dow>6))throw new Error('Invalid weekday.');
    if(s.frequency==='monthly'&&(!Number.isInteger(dom)||dom<1||dom>31))throw new Error('Invalid month day.');
    // UTC date arithmetic is only used for calendar labels; wallTime applies the timezone.
    for(let offset=0;offset<370;offset++) {
      const day=new Date(Date.UTC(p.year,p.month-1,p.day+offset));
      const y=day.getUTCFullYear(),m=day.getUTCMonth(),d=day.getUTCDate();
      if(s.frequency==='weekly'&&day.getUTCDay()!==dow)continue;
      if(s.frequency==='monthly'&&d!==Math.min(dom,new Date(Date.UTC(y,m+1,0)).getUTCDate()))continue;
      let candidate;
      try {candidate=wallTime(y,m,d,hour,s.timezone);}catch(e){if(e instanceof RangeError)throw e;continue;}
      if(candidate>now)return candidate;
    }
    throw new Error('Could not determine the next posting date.');
  }
  function nextCanonical(s, after) {
    const first = new Date(s.firstRunAtUtc);
    if(!Number.isFinite(first.getTime()))throw Error('Choose a valid first posting date.');
    if(first>after)return first;
    if(s.frequency==='once')return null;
    const p=localParts(first,s.timezone);
    for(let n=1;n<10000;n++) {
      let d;
      if(['monthly','quarterly'].includes(s.frequency)) {
        const m=new Date(Date.UTC(p.year,p.month-1+n*(s.frequency==='quarterly'?3:1),1));
        d=new Date(Date.UTC(m.getUTCFullYear(),m.getUTCMonth(),Math.min(p.day,new Date(Date.UTC(m.getUTCFullYear(),m.getUTCMonth()+1,0)).getUTCDate())));
      } else d=new Date(Date.UTC(p.year,p.month-1,p.day+n*(s.frequency==='biweekly'?14:s.frequency==='weekly'?7:1)));
      let candidate;
      try {candidate=wallTime(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),p.hour,s.timezone,p.minute);}
      catch(e){if(e instanceof RangeError)throw e;continue;}
      if(candidate>after)return candidate;
    }
    throw Error('Could not determine the next posting date.');
  }
  function validateSchedule(input, now=new Date(), previous={}) {
    const s=normalizeSchedule(input);
    if(s.unsupportedFrequency||s.frequency==='daily')throw Error('Choose once, weekly, every two weeks, monthly, or quarterly.');
    const first=new Date(input.firstRunAtUtc);
    if(!Number.isFinite(first.getTime())||first<=now)throw Error('Choose a future date and time.');
    localParts(first,s.timezone);
    const pick=(key,values,def)=>{const value=input[key]||def;if(!values.includes(value))throw Error('Invalid '+key);return value;};
    const count=Number(input.stopAfterCount||0);
    const stopMode=pick('stopMode',['never','count'],'never');
    if(stopMode==='count'&&(!Number.isInteger(count)||count<1||count>1000))throw Error('Choose a valid stop-after count.');
    return {version:1,enabled:true,firstRunAtUtc:first.toISOString(),nextRunAt:first.toISOString(),lastRunAt:previous.lastRunAt||null,
      timezone:s.timezone,frequency:s.frequency,stopMode:s.frequency==='once'?'count':stopMode,
      stopAfterCount:s.frequency==='once'?1:count,runsCompleted:0,
      copyBehavior:s.frequency==='once'?'reuse':pick('copyBehavior',['reuse','refresh','ask'],'reuse'),
      imageBehavior:s.frequency==='once'?'reuse':pick('imageBehavior',['reuse','remind','ask'],'reuse'),
      approvalBehavior:pick('approvalBehavior',['always','automatic','attention'],'always'),
      revision:(previous.revision||0)+1,status:'active'};
  }
  function advanceSchedule(s, now, skipped=false) {
    const next=computeNextRunAt(s,new Date(Math.max(Date.parse(s.nextAnchorAt||s.nextRunAt),Date.parse(s.nextRunAt),new Date(now).getTime())));
    const runs=(s.runsCompleted||0)+(skipped?0:1);
    const complete=!next||(s.stopMode==='count'&&runs>=s.stopAfterCount);
    const value={...s,runsCompleted:runs,nextRunAt:complete?null:next.toISOString(),enabled:!complete,status:complete?'completed':'active',
      lastRunAt:skipped?s.lastRunAt:new Date(now).toISOString(),revision:(s.revision||0)+1};
    delete value.preparedBlastId;delete value.pauseReason;delete value.nextAnchorAt;
    return value;
  }
  return { normalizeSchedule, computeNextRunAt, frequencies, validateSchedule, advanceSchedule, localParts, wallTime };
});
