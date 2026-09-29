// Canonical browser/server recurrence rules. public/schedule-utils.js is generated.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BBSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const slots = { morning: 9, midday: 12, afternoon: 15, evening: 18 };
  const frequencies = ['daily', 'weekly', 'monthly'];
  function normalizeSchedule(input = {}) {
    const s = { ...input, frequency: input.frequency || 'weekly', timezone: input.timezone || 'America/New_York', timeSlot: input.timeSlot || 'morning' };
    if (!frequencies.includes(s.frequency)) {
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
  function wallTime(year, month, day, hour, timezone) {
    const target = Date.UTC(year,month,day,hour);
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
    if(s.unsupportedFrequency)throw new Error('Choose daily, weekly, or monthly before enabling this schedule.');
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
  return { normalizeSchedule, computeNextRunAt, frequencies };
});
