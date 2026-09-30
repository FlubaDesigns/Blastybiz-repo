BBBlasty.loginDefaults = {
    pickTab:         { text: "👆 Pick Sign In or Create Account — or use Google / Facebook below!",  mood: 's-wave'      },
    signinWelcome:   { text: "Welcome back! Sign in to keep blasting. 🚀",                          mood: 's-wave'      },
    signinEmail:     { text: "Enter the email you signed up with — or sign in with Google or Facebook below!",  mood: 's-ask' },
    signinPassword:  { text: "Enter your BlastyBiz password.",                                      mood: 's-ask'       },
    signupWelcome:       { text: "Create your account — or sign up instantly with Google or Facebook below! 🚀",                                   mood: 's-wave'      },
    signupWelcomeGuided: { text: "Let's get you set up! 🚀 Create your account — or tap Google / Facebook below to sign up in one click.",         mood: 's-wave'      },
    signupWelcomeForms:  { text: "Fast lane it is! 📋 Create your account — or use Google / Facebook below to jump straight in.",                  mood: 's-happy'     },
    billing:         { text: "Annual saves you two months free and locks in your rate. Switch anytime.",               mood: 's-wave'  },
    planStarter:     { text: "Starter is free forever — great for getting your first location blasting.",              mood: 's-ask'   },
    planPro:         { text: "Smart choice! 🔥 Pro gives you room for more businesses and a larger AI budget!",  mood: 's-happy' },
    planAgency:      { text: "Agency lets you manage multiple businesses from one dashboard. Built for franchises and multi-location brands. 💼", mood: 's-happy' },
    name:            { text: "What's your name? We'll personalize your experience.",               mood: 's-ask'       },
    email:           { text: "What email should we use for your account?",         mood: 's-ask'       },
    password:        { text: "8+ characters with letters and numbers.",                            mood: 's-ask'       },
    confirmPassword: { text: "Type it one more time — almost there!",                              mood: 's-happy'     },
    reset:           { text: "We'll send a reset link right away.",                                mood: 's-tilt-left' },
    signupDone:      { text: "🎉 You're in! Check your email — we just sent you a verification link to activate your account.", mood: 's-happy' },
  };
BBBlasty.setupSteps = function(){
return [
  {field:'f-sellerType',section:'cbs-info',ask:'Are you promoting a business or selling something personally?'},
  { field:'f-ownerName', section:'cbs-info', mood:'s-wave',
    ask:"Hey! I'm Blasty — I'll write your ads. First up, what should I call you?",
    hint:'First name is fine.' },
  { field:'f-bizName', section:'cbs-info', mood:'s-ask',
    ask:function(a){ return (a['f-ownerName'] ? 'Good to meet you, ' + a['f-ownerName'].split(' ')[0] + '. ' : '') + "What's the business called?"; },
    hint:'Exactly how you want it to appear in your ads.' },
  { field:'f-role', section:'cbs-info', ask:"What's your title there?", hint:'Owner, Manager, Founder…' },
  { field:'f-email', section:'cbs-info', ask:'What email should customers reach you at?' },
  { field:'f-phone', section:'cbs-info', ask:'Best phone number for customers?' },
  { field:'f-locationType', section:'cbs-info', ask:'Do customers come to you, or are you online only?' },
  { field:'f-street', section:'cbs-info', skipIf:cbIsOnline, ask:"What's the street address?" },
  { field:'f-city',   section:'cbs-info', skipIf:cbIsOnline, ask:'Which city?' },
  { field:'f-state',  section:'cbs-info', skipIf:cbIsOnline, ask:'And the state?' },
  { field:'f-zip',    section:'cbs-info', skipIf:cbIsOnline, ask:'ZIP code?' },
  { field:'f-hasWebsite', section:'cbs-info', skipIf:cbIsOnline, ask:'Does your business have a website?' },
  { field:'f-website', section:'cbs-info', skipIf:a=>!cbIsOnline(a)&&a['f-hasWebsite']==='no', ask:'Got a website I should point people to?' },
  { field:'f-story', section:'cbs-story', mood:'s-ask',
    ask:'Now the good stuff — how did the business get started?',
    hint:'The more you tell me, the less generic your ads sound.' },
  { field:'f-different', section:'cbs-story', ask:'What makes you different from the competition?' },
  { field:'f-awards', section:'cbs-story', ask:'Any awards, reviews, certifications or milestones? You can choose Nothing yet.' },
  { field:'f-customer', section:'cbs-story', ask:'Who is your ideal customer?' },
  { field:'f-other', section:'cbs-story', ask:'Anything else I should always keep in mind? You can choose Nothing else.' },
  { field:'f-campName', section:'cbs-campaign', mood:'s-working',
    ask:"Last stretch. What do you want to call this first campaign?", hint:'e.g. Summer Sale, Grand Opening' },
  { field:'f-about', section:'cbs-campaign',
    ask:"What's this campaign about?", hint:'What are you promoting right now?' },
  { field:'f-offer', section:'cbs-campaign', ask:'Any special offer or call to action?' },
  { field:'f-audience', section:'cbs-campaign', ask:'Who should see it?' },
  { group:'plat-grid-wrap', section:'cbs-campaign', mood:'s-celebrate',
    ask:'Where do you want me to blast this?', hint:'Tick as many as you like — you can change these later.' }
];
};

BBBlasty.loginDefaults.businessName={text:BBBlasty.message('profile.businessName',{},true)||'Business name?',mood:'s-ask'};
BBBlasty.loginDefaults.ownerRole={text:BBBlasty.message('profile.role',{},true)||'Your role?',mood:'s-ask'};
BBBlasty.loginDefaults.phone={text:BBBlasty.message('profile.phone',{},true)||'Phone number?',mood:'s-ask'};
const defaultSetupSteps=BBBlasty.setupSteps;
BBBlasty.setupSteps=function(){
 const map={'f-ownerName':'profile.ownerName','f-bizName':'profile.businessName','f-role':'profile.role','f-email':'profile.contactEmail','f-phone':'profile.phone','f-locationType':'profile.locationType','f-street':'profile.street','f-city':'profile.city','f-state':'profile.state','f-zip':'profile.zip','f-website':'profile.website','f-story':'story.origin','f-different':'story.differentiation','f-awards':'story.proof','f-customer':'story.idealCustomer','f-other':'story.additionalContext'};
 return defaultSetupSteps().map(step=>{const key=map[step.field];if(key&&BBBlasty.fields[key]){const old=step.ask;step.ask=a=>BBBlasty.message(key,a,true)||(typeof old==='function'?old(a):old);}return step;});
};

BBBlasty.campaignSteps=function(collected={}){
const ccCol=collected;
const $cc=id=>document.getElementById(id);
if((window._bbProfileGlobal||{}).sellerType==='personal'){
 const itemName=$cc('new-campaign-input')?.value?.trim();
 if(itemName)ccCol.campaignName=itemName;
 return [
 ...(!ccCol.campaignName?[{msg:()=> 'What are you selling?',field:()=> 'campaignName',label:'Item name',validate:v=>v.trim().length>1,placeholder:()=> 'e.g. GEM electric vehicle',optional:false}]:[]),
 {msg:()=> 'Tell me about its condition, specifications and any known defects. You can skip this.',field:()=> 'offer',label:'Item condition (optional)',optional:true,placeholder:()=> 'Optional item condition and details'},
 {msg:()=> 'What is your asking price? You can skip this.',field:()=> 'price',label:'Price (optional)',optional:true,placeholder:()=> 'Optional asking price'},
 {msg:()=> 'Will buyers pick it up, or can you deliver or ship it? You can skip this.',field:()=> 'pickup',label:'Pickup or delivery (optional)',optional:true,placeholder:()=> 'Optional pickup, delivery or shipping details'},
 {msg:()=> 'Is there a deadline or availability date buyers should know?',field:()=> 'dates',label:'Availability',optional:true,placeholder:()=> 'Optional availability or deadline'}
 ];
}
return [
  {
    msg: () => {
      const n = $cc('new-campaign-input')?.value?.trim();
      if (n) { ccCol.campaignName = n; return `Building the brief for "${n}" — sounds great! 🚀\n\nWhat's the main offer or message for this campaign? (e.g. "25% off all services", "Grand reopening with live music")`; }
      return 'What are you calling this campaign? (e.g. "Summer Sale", "Grand Reopening", "Holiday Special")';
    },
    field: () => ccCol.campaignName ? 'offer' : 'campaignName',
    label: 'Campaign Name',
    validate: v => v.trim().length > 1,
    placeholder: () => ccCol.campaignName ? 'e.g. 20% off everything through the end of the month' : 'e.g. Christmas Sale',
    optional: () => !!ccCol.campaignName,
  },
  {
    msg: () => ccCol.campaignName && !ccCol.offer
      ? `Got it — "${ccCol.campaignName}"! What's the main offer or hook for this one?`
      : `Any pricing to know about? (Skip if there's nothing specific)`,
    field: () => ccCol.campaignName && !ccCol.offer ? 'offer' : 'price',
    label: 'Campaign Details',
    optional: true,
    placeholder: () => ccCol.campaignName && !ccCol.offer ? 'e.g. Free consultation with any booking' : 'e.g. Starting at $49, or 30% off',
  },
  {
    msg: () => `When does this campaign run? (Skip if it's ongoing)`,
    field: () => 'dates',
    label: 'Campaign Dates',
    optional: true,
    placeholder: () => 'e.g. July 4–10, or "through end of summer"',
  },
];
};
