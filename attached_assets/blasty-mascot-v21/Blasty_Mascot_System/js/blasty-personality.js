/** BlastyPersonality: local personality, adaptive verbosity, milestones, gaze and contextual coaching. */
export class BlastyPersonality extends EventTarget {
  static MODES = new Set(['friendly','balanced','minimal','silent']);
  constructor({controller,mode='balanced',storageKey='blasty-personality-v21',userLevel='auto'}={}){
    super(); if(!controller) throw new Error('BlastyPersonality requires a controller');
    this.b=controller; this.storageKey=storageKey; this.mode=mode; this.userLevel=userLevel;
    this.stats={sessions:0,completedSteps:0,milestones:[],lastSeen:null}; this.restore(); this.beginSession();
  }
  beginSession(){this.stats.sessions++;this.stats.lastSeen=new Date().toISOString();this.save();}
  setMode(mode){if(!BlastyPersonality.MODES.has(mode))throw new TypeError('Unsupported personality mode');this.mode=mode;this.save();this.dispatchEvent(new CustomEvent('modechange',{detail:{mode}}));return this;}
  effectiveLevel(){if(this.userLevel!=='auto')return this.userLevel;const s=this.stats.sessions;return s<=2?'new':s<=8?'learning':'experienced';}
  shouldSpeak(kind='routine'){
    if(this.mode==='silent')return kind==='critical';
    if(this.mode==='minimal')return ['critical','milestone','question'].includes(kind);
    if(this.mode==='friendly')return true;
    const level=this.effectiveLevel();
    if(level==='new')return true;
    if(level==='learning')return kind!=='filler';
    return ['critical','milestone','question','insight'].includes(kind);
  }
  say(text,opts={}){const kind=opts.kind||'routine';if(!this.shouldSpeak(kind)){this.b.setBubbleVisible(false);this.b.setState(opts.state||'happy',{duration:700});return false;}this.b.say(text,opts);return true;}
  greet({name,business,lastTask}={}){
    const level=this.effectiveLevel(); let text;
    if(level==='new') text=name?`Welcome back, ${name}. I’ll keep this simple and help you through each step.`:'Hi! I’m Blasty. I’ll help you get set up without making this complicated.';
    else if(lastTask) text=`Welcome back. We left off at ${lastTask}. Ready to continue?`;
    else text=business?`${business} is ready when you are.`:'Ready when you are.';
    return this.say(text,{kind:'question',state:'talking',hold:2200});
  }
  accepted({business}={}){this.stats.completedSteps++;this.save();const choices=business?[`Nice — that helps me understand ${business}.`,`Good. ${business} is taking shape.`,`Got it. That gives me a clearer picture.`]:['Perfect. I’ve got it.','Nice. That helps.','Good — another piece finished.'];return this.say(choices[this.stats.completedSteps%choices.length],{kind:'filler',state:'happy',hold:900});}
  explainWhy(text){return this.say(text,{kind:'insight',state:'talking',hold:2600});}
  thinking(text='I’m putting the pieces together…'){return this.say(text,{kind:'routine',state:'thinking',hold:0});}
  milestone(id,text,{target,confetti=true}={}){if(this.stats.milestones.includes(id))return false;this.stats.milestones.push(id);this.save();if(target)this.b.pointTo(target);this.b.celebrate(text||'That is a real milestone. Nice work!');if(confetti)this.b.confetti();this.dispatchEvent(new CustomEvent('milestone',{detail:{id}}));return true;}
  confidence(score){const s=Math.max(0,Math.min(1,Number(score)||0));const text=s>.88?'Now this is looking strong.':s>.68?'I’m pretty confident we have what we need.':s>.45?'We have a good start. One or two details will sharpen it.':'I need a little more detail before I trust this.';return this.say(text,{kind:'insight',state:s>.68?'happy':'thinking',hold:2100});}
  lookAt(target,opts){this.b.lookAt(target,opts);return this;}
  save(){try{localStorage.setItem(this.storageKey,JSON.stringify({mode:this.mode,userLevel:this.userLevel,stats:this.stats}));}catch{}}
  restore(){try{const x=JSON.parse(localStorage.getItem(this.storageKey)||'null');if(x){if(BlastyPersonality.MODES.has(x.mode))this.mode=x.mode;this.userLevel=x.userLevel||this.userLevel;this.stats={...this.stats,...x.stats};}}catch{}}
}
