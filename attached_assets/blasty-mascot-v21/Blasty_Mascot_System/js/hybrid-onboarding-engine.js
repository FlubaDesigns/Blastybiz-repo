/** Hybrid onboarding orchestrator: local conversation + strategic AI checkpoints. */
export class HybridOnboardingEngine extends EventTarget {
  constructor({guide, ai, mascot, storage=sessionStorage}){super();this.guide=guide;this.ai=ai;this.mascot=mascot;this.storage=storage;this.answers={};this.history=[];this.track='general';this.queue=[];this.callCount=0;this.maxCalls=4;}
  async start(seed={}){this.answers={...seed};this.queue=[...this.guide.required];return this.next();}
  async submit(value){const step=this.current;if(!step)return;
    const parsed=step.parse?step.parse(value):value;const error=step.validate?.(parsed,this.answers);
    if(error){this.mascot.warn(error);this.dispatchEvent(new CustomEvent('validation',{detail:{step,error}}));return;}
    this.answers[step.id]=parsed;this.history.push({role:'user',step:step.id,content:String(value)});this.mascot.celebrate(this.localPhrase('accepted',step));
    if(step.checkpoint==='classify') await this.classify();
    if(step.checkpoint==='analyze') await this.analyze();
    return this.next();
  }
  async next(){this.current=this.queue.shift();if(!this.current)return this.finalize();const prompt=typeof this.current.prompt==='function'?this.current.prompt(this.answers):this.current.prompt;this.mascot.say(prompt);this.dispatchEvent(new CustomEvent('step',{detail:{step:this.current,prompt}}));return this.current;}
  localPhrase(type,step){const bank=this.guide.voice[type]||['Got it.'];const i=(Object.keys(this.answers).length+step.id.length)%bank.length;return bank[i].replace('{business}',this.answers.bizName||'your business');}
  enqueue(ids){const byId=this.guide.steps;this.queue.unshift(...ids.map(id=>byId[id]).filter(Boolean));}
  async checkpoint(name,payload){if(this.callCount>=this.maxCalls)throw new Error('AI call budget exhausted');this.callCount++;this.mascot.think();const result=await this.ai[name](payload);this.dispatchEvent(new CustomEvent('aicall',{detail:{name,count:this.callCount,result}}));return result;}
  async classify(){const r=await this.checkpoint('classifyBusiness',{answers:this.answers});this.track=r.track||'general';const ids=this.guide.tracks[this.track]||this.guide.tracks.general;this.enqueue(ids.filter(id=>!this.answers[id]));this.answers.classification=r;}
  async analyze(){const r=await this.checkpoint('analyzeBusiness',{answers:this.answers,track:this.track});this.answers.analysis=r;if(r.requiredFollowUp?.id){this.guide.steps[r.requiredFollowUp.id]={...r.requiredFollowUp,aiGenerated:true};this.enqueue([r.requiredFollowUp.id]);}}
  async finalize(){const r=await this.checkpoint('generateProfile',{answers:this.answers,track:this.track});this.answers.generatedProfile=r;this.mascot.launch(`You're all set! Let's launch ${this.answers.bizName||'your business'}.`);this.storage.setItem('blastyOnboardingDraft',JSON.stringify({answers:this.answers,callCount:this.callCount,completedAt:Date.now()}));this.dispatchEvent(new CustomEvent('complete',{detail:{profile:r,answers:this.answers,callCount:this.callCount}}));return r;}
}
