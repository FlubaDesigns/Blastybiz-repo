/** BlastyController: synchronizes application state with SVG layers and user placement. */
export class BlastyController extends EventTarget {
  static STATES = new Set(['hidden','idle','thinking','talking','happy','celebrating','warning','launching','arriving','sleeping']);
  constructor({
    host,
    svgUrl='assets/blasty-mascot.svg',
    reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches,
    draggable=true,
    autoPark=true,
    parkDelay=12000,
    storageKey='blasty-ui-placement-v1'
  }={}) {
    super();
    this.host=typeof host==='string'?document.querySelector(host):host;
    this.svgUrl=svgUrl;
    this.reducedMotion=reducedMotion;
    this.draggable=draggable;
    this.autoPark=autoPark;
    this.parkDelay=parkDelay;
    this.storageKey=storageKey;
    this.state='hidden';
    this.svg=null;
    this.layers={};
    this.timer=null;
    this.parkTimer=null;
    this.parked=false;
    this.drag=null;
    this.lastPosition=null;
    this.gazeTimer=null;
    this.pointerGaze=false;
    if(!this.host) throw new Error('Blasty host element was not found');
  }

  async mount(){
    const markup=await fetch(this.svgUrl,{cache:'force-cache'}).then(r=>{if(!r.ok)throw new Error(`Blasty SVG ${r.status}`);return r.text()});
    this.host.innerHTML=markup;
    this.svg=this.host.querySelector('#blasty-svg');
    ['rocket','speech-bubble','bubble-text','engine-glow','engine','flame-outer','flame-middle','flame-inner','smoke','motion-lines','shadow','eyes','eyelids','mouth-happy','mouth-talking','mouth-concerned','eye-left','eye-right'].forEach(id=>this.layers[id]=this.host.querySelector(`#${id}`));
    this.host.classList.add('blasty-shell','is-interactive');
    this.host.tabIndex=0;
    this.host.setAttribute('role','button');
    this.host.setAttribute('aria-label','Blasty onboarding assistant. Drag to move.');
    this.restorePlacement();
    this.bindPlacement();
    this.bindAmbientBehavior();
    this.setState('arriving',{announce:false});
    setTimeout(()=>this.setState('idle',{announce:false}),850);
    this.resetParkTimer();
    return this;
  }

  setState(next,{duration=0,announce=true}={}){
    if(!BlastyController.STATES.has(next)) throw new TypeError(`Unsupported Blasty state: ${next}`);
    if(this.timer)clearTimeout(this.timer);
    this.svg?.classList.remove(...[...BlastyController.STATES].map(s=>`state-${s}`));
    this.svg?.classList.add(`state-${next}`);
    this.state=next;
    this.host.classList.toggle('is-hidden',next==='hidden');
    if(next!=='idle' && next!=='sleeping' && this.parked) this.unpark();
    if(announce)this.dispatchEvent(new CustomEvent('statechange',{detail:{state:next}}));
    if(duration>0)this.timer=setTimeout(()=>this.setState('idle'),duration);
    this.resetParkTimer();
    return this;
  }

  say(text,{state='talking',hold=1400,announce=true}={}){
    const safe=String(text??'').trim(); if(!safe)return this;
    this.unpark();
    if(this.layers['bubble-text'])this.layers['bubble-text'].textContent=safe;
    this.host.classList.remove('blasty-bubble-hidden');
    this.setState(state,{announce});
    this.host.setAttribute('aria-label',`Blasty says: ${safe}`);
    if(hold>0)this.timer=setTimeout(()=>this.setState('idle'),Math.max(hold,Math.min(5200,safe.length*42)));
    return this;
  }

  think(text='Let me think about that…'){return this.say(text,{state:'thinking',hold:0})}
  celebrate(text='Nice! That step is complete.'){return this.say(text,{state:'celebrating',hold:1700})}
  warn(text){return this.say(text,{state:'warning',hold:2200})}
  launch(text='Ready for the next step!'){this.say(text,{state:'launching',hold:0});setTimeout(()=>this.setState('hidden'),1100);return this}
  show(){this.host.classList.remove('is-hidden');if(this.state==='hidden')this.setState('arriving');return this}
  hide(){return this.setState('hidden')}
  setBubbleVisible(visible){this.host.classList.toggle('blasty-bubble-hidden',!visible);return this}

  pointTo(element,{padding=8}={}){
    const target=typeof element==='string'?document.querySelector(element):element; if(!target)return this;
    this.unpark();
    target.scrollIntoView({behavior:this.reducedMotion?'auto':'smooth',block:'center'});
    target.classList.add('blasty-target');
    target.style.setProperty('--blasty-pad',`${padding}px`);
    setTimeout(()=>target.classList.remove('blasty-target'),2400);
    return this;
  }

  react(event,payload={}){
    const map={step_enter:'talking',valid:'happy',invalid:'warning',ai_start:'thinking',ai_done:'happy',milestone:'celebrating',finish:'launching',idle:'idle'};
    return this.setState(map[event]||'idle',payload);
  }


  bindAmbientBehavior(){
    document.addEventListener('pointermove',e=>{
      if(!this.pointerGaze||this.parked||this.state==='sleeping')return;
      this.lookAt({x:e.clientX,y:e.clientY},{duration:0});
    },{passive:true});
  }

  enablePointerGaze(enabled=true){this.pointerGaze=Boolean(enabled);if(!enabled)this.resetGaze();return this;}

  lookAt(target,{duration=1800,max=4}={}){
    if(this.parked||!this.svg)return this;
    let x,y;
    if(target?.x!=null){x=target.x;y=target.y;} else {const el=typeof target==='string'?document.querySelector(target):target;if(!el)return this;const r=el.getBoundingClientRect();x=r.left+r.width/2;y=r.top+r.height/2;}
    const r=this.svg.getBoundingClientRect(),cx=r.left+r.width*.39,cy=r.top+r.height*.36;
    const dx=Math.max(-max,Math.min(max,(x-cx)/80)),dy=Math.max(-max,Math.min(max,(y-cy)/80));
    this.layers['eyes']?.style.setProperty('transform',`translate(${dx}px,${dy}px)`);
    clearTimeout(this.gazeTimer);if(duration>0)this.gazeTimer=setTimeout(()=>this.resetGaze(),duration);return this;
  }
  resetGaze(){this.layers['eyes']?.style.removeProperty('transform');return this;}

  confetti(){
    if(this.reducedMotion)return this;
    const burst=document.createElement('div');burst.className='blasty-confetti';
    burst.innerHTML=Array.from({length:10},(_,i)=>`<i style="--i:${i}"></i>`).join('');
    this.host.appendChild(burst);setTimeout(()=>burst.remove(),1300);return this;
  }

  setPersonalityMode(mode){this.host.dataset.personality=mode;return this;}

  bindPlacement(){
    if(!this.draggable) return;
    this.host.classList.add('is-draggable');
    this.host.addEventListener('pointerdown',e=>this.onPointerDown(e));
    window.addEventListener('pointermove',e=>this.onPointerMove(e),{passive:false});
    window.addEventListener('pointerup',e=>this.onPointerUp(e));
    window.addEventListener('pointercancel',e=>this.onPointerUp(e));
    window.addEventListener('resize',()=>this.constrainToViewport());
    this.host.addEventListener('keydown',e=>{
      if((e.key==='Enter'||e.key===' ')&&this.parked){e.preventDefault();this.unpark();}
    });
  }

  onPointerDown(e){
    if(e.button!==undefined && e.button!==0) return;
    if(this.parked){
      this.unpark();
      return;
    }
    const rect=this.host.getBoundingClientRect();
    this.drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,left:rect.left,top:rect.top,moved:false};
    this.host.setPointerCapture?.(e.pointerId);
    this.host.classList.add('is-dragging');
    this.clearParkTimer();
  }

  onPointerMove(e){
    if(!this.drag || e.pointerId!==this.drag.id) return;
    const dx=e.clientX-this.drag.startX, dy=e.clientY-this.drag.startY;
    if(Math.abs(dx)+Math.abs(dy)>4)this.drag.moved=true;
    const rect=this.host.getBoundingClientRect();
    const margin=8;
    const left=Math.min(Math.max(margin,this.drag.left+dx),Math.max(margin,innerWidth-rect.width-margin));
    const top=Math.min(Math.max(margin,this.drag.top+dy),Math.max(margin,innerHeight-rect.height-margin));
    this.applyPosition(left,top);
    e.preventDefault();
  }

  onPointerUp(e){
    if(!this.drag || e.pointerId!==this.drag.id) return;
    this.host.releasePointerCapture?.(e.pointerId);
    this.host.classList.remove('is-dragging');
    if(this.drag.moved){
      const rect=this.host.getBoundingClientRect();
      this.lastPosition={left:rect.left,top:rect.top};
      this.savePlacement();
      this.dispatchEvent(new CustomEvent('positionchange',{detail:{...this.lastPosition}}));
    }
    this.drag=null;
    this.resetParkTimer();
  }

  applyPosition(left,top){
    this.host.style.left=`${Math.round(left)}px`;
    this.host.style.top=`${Math.round(top)}px`;
    this.host.style.right='auto';
    this.host.style.bottom='auto';
  }

  constrainToViewport(){
    if(this.parked)return;
    const rect=this.host.getBoundingClientRect(), margin=8;
    this.applyPosition(
      Math.min(Math.max(margin,rect.left),Math.max(margin,innerWidth-rect.width-margin)),
      Math.min(Math.max(margin,rect.top),Math.max(margin,innerHeight-rect.height-margin))
    );
    const updated=this.host.getBoundingClientRect();
    this.lastPosition={left:updated.left,top:updated.top};
    this.savePlacement();
  }

  park(){
    if(this.parked || this.state==='hidden' || this.drag) return this;
    const rect=this.host.getBoundingClientRect();
    this.lastPosition={left:rect.left,top:rect.top};
    this.parked=true;
    this.host.classList.add('is-parked','is-garaged','blasty-bubble-hidden');
    this.host.style.left='12px';
    this.host.style.top='auto';
    this.host.style.right='auto';
    this.host.style.bottom='12px';
    this.host.setAttribute('aria-label','Blasty is parked. Activate to reopen.');
    this.savePlacement();
    this.dispatchEvent(new CustomEvent('parkchange',{detail:{parked:true}}));
    return this;
  }

  unpark(){
    if(!this.parked)return this;
    this.parked=false;
    this.host.classList.remove('is-parked','is-garaged');
    if(this.lastPosition)this.applyPosition(this.lastPosition.left,this.lastPosition.top);
    else {this.host.style.left='auto';this.host.style.top='auto';this.host.style.right='clamp(12px,3vw,28px)';this.host.style.bottom='clamp(12px,3vw,24px)';}
    this.host.setAttribute('aria-label','Blasty onboarding assistant. Drag to move.');
    this.savePlacement();
    this.resetParkTimer();
    this.dispatchEvent(new CustomEvent('parkchange',{detail:{parked:false}}));
    return this;
  }

  resetParkTimer(){
    this.clearParkTimer();
    if(!this.autoPark || this.parked || this.state==='hidden' || this.state==='thinking' || this.state==='talking')return;
    this.parkTimer=setTimeout(()=>this.park(),this.parkDelay);
  }
  clearParkTimer(){if(this.parkTimer){clearTimeout(this.parkTimer);this.parkTimer=null;}}

  savePlacement(){
    try{localStorage.setItem(this.storageKey,JSON.stringify({position:this.lastPosition,parked:this.parked}));}catch{}
  }
  restorePlacement(){
    try{
      const saved=JSON.parse(localStorage.getItem(this.storageKey)||'null');
      if(saved?.position){this.lastPosition=saved.position;this.applyPosition(saved.position.left,saved.position.top);}
      if(saved?.parked){this.parked=true;this.host.classList.add('is-parked','is-garaged','blasty-bubble-hidden');this.host.style.left='12px';this.host.style.top='auto';this.host.style.right='auto';this.host.style.bottom='12px';}
    }catch{}
  }
}
