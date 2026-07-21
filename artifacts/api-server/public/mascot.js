/* mascot.js — Portable self-contained rocket mascot component v1.0
   Usage: <script src="/mascot.js"></script>
   Place an empty <div class="pb-mascot" id="pb-mascot"></div> anywhere.
   API: window.PBMascot.setMood(moodOrSpec) | .setPosition(pos) | .miniSVG(mood)
*/
(function () {
  'use strict';

  /* ── CSS ──────────────────────────────────────────────────────────────── */
  var CSS = [
    /* Base */
    '.pb-mascot{position:relative;display:inline-block;',
    '  --flame-top:#ffdc2f;--flame-mid:#ff961f;--flame-bot:#ef3d10;',
    '  --flamein-top:#fffbd7;--flamein-mid:#fff04c;--flamein-bot:#ffac20;}',
    '#mascot-svg{width:100%;height:auto;overflow:visible;',
    '  transform-box:fill-box;transform-origin:bottom center;}',

    /* Idle float */
    '#mascot-body{transform-box:fill-box;transform-origin:bottom center;',
    '  animation:b-float 3.2s ease-in-out infinite;}',
    '@keyframes b-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}',

    /* Arrive pop */
    '.pb-mascot.s-arrive #mascot-svg{animation:b-arrive .45s cubic-bezier(.34,1.56,.64,1) both;}',
    '@keyframes b-arrive{0%{transform:scale(.6) translateY(18px);opacity:0}100%{transform:scale(1) translateY(0);opacity:1}}',

    /* Flame pulse */
    '.flame{transform-box:fill-box;transform-origin:top center;animation:b-flame-pulse .5s ease-in-out infinite;}',
    '@keyframes b-flame-pulse{0%,100%{transform:scaleY(1) scaleX(1)}50%{transform:scaleY(1.35) scaleX(.8)}}',

    /* Mouths — happy is default; others hidden */
    '.pb-mascot .mouth-working,.pb-mascot .mouth-celebrate,.pb-mascot .mouth-ask{opacity:0!important;}',
    '.pb-mascot.s-working  .mouth-happy{opacity:0!important;}.pb-mascot.s-working  .mouth-working{opacity:1!important;}',
    '.pb-mascot.s-celebrate .mouth-happy{opacity:0!important;}.pb-mascot.s-celebrate .mouth-celebrate{opacity:1!important;}',
    '.pb-mascot.s-ask      .mouth-happy{opacity:0!important;}.pb-mascot.s-ask      .mouth-ask{opacity:1!important;}',
    '.pb-mascot.s-ask-2    .mouth-happy{opacity:0!important;}.pb-mascot.s-ask-2    .mouth-ask{opacity:1!important;}',
    '.pb-mascot.s-ask-3    .mouth-happy{opacity:0!important;}.pb-mascot.s-ask-3    .mouth-ask{opacity:1!important;}',

    /* Standalone mouth overrides — priority over mood-driven mouth */
    '.pb-mascot.s-mouth-happy .mouth-working,.pb-mascot.s-mouth-happy .mouth-celebrate,.pb-mascot.s-mouth-happy .mouth-ask{opacity:0!important;}',
    '.pb-mascot.s-mouth-happy .mouth-happy{opacity:1!important;}',
    '.pb-mascot.s-mouth-working .mouth-happy,.pb-mascot.s-mouth-working .mouth-celebrate,.pb-mascot.s-mouth-working .mouth-ask{opacity:0!important;}',
    '.pb-mascot.s-mouth-working .mouth-working{opacity:1!important;}',
    '.pb-mascot.s-mouth-celebrate .mouth-happy,.pb-mascot.s-mouth-celebrate .mouth-working,.pb-mascot.s-mouth-celebrate .mouth-ask{opacity:0!important;}',
    '.pb-mascot.s-mouth-celebrate .mouth-celebrate{opacity:1!important;}',
    '.pb-mascot.s-mouth-ask .mouth-happy,.pb-mascot.s-mouth-ask .mouth-working,.pb-mascot.s-mouth-ask .mouth-celebrate{opacity:0!important;}',
    '.pb-mascot.s-mouth-ask .mouth-ask{opacity:1!important;}',
    /* Arms */
    '.mascot-arm{transition:opacity .25s ease;opacity:0;}',
    '.pb-mascot.s-wave    .mascot-arm-wave{opacity:1!important;}',
    '.pb-mascot.s-wave-2  .mascot-arm-wave{opacity:1!important;}',
    '.pb-mascot.s-working .mascot-arm-point{opacity:1!important;}',
    '.pb-mascot.s-celebrate .mascot-arm-wave{opacity:1!important;}',

    /* s-wave */
    '.pb-mascot.s-wave #mascot-body{animation:b-wave .55s ease-in-out 4,b-float 3.2s ease-in-out infinite 2.2s;}',
    '@keyframes b-wave{0%,100%{transform:rotate(0deg) translateY(0)}25%{transform:rotate(-22deg) translateY(-8px)}65%{transform:rotate(16deg) translateY(-4px)}}',
    '.pb-mascot.s-wave .pupil-group-l,.pb-mascot.s-wave .pupil-group-r{transform:scale(1.1) translateY(-3px);}',

    /* s-wave-2 */
    '.pb-mascot.s-wave-2 #mascot-body{animation:b-wave-big .45s ease-in-out 5,b-float 3.2s ease-in-out infinite 2.25s;}',
    '@keyframes b-wave-big{0%,100%{transform:rotate(0deg) translateY(0)}25%{transform:rotate(-28deg) translateY(-12px)}65%{transform:rotate(20deg) translateY(-6px)}}',
    '.pb-mascot.s-wave-2 .pupil-group-l,.pb-mascot.s-wave-2 .pupil-group-r{transform:scale(1.15) translateY(-4px);}',

    /* s-happy */
    '.pb-mascot.s-happy #mascot-body{animation:b-bounce .4s ease-in-out 3,b-float 3.2s ease-in-out infinite 1.2s;}',
    '@keyframes b-bounce{0%{transform:translateY(0) scale(1,1)}35%{transform:translateY(-28px) scale(.9,1.15)}65%{transform:translateY(-22px) scale(.9,1.15)}85%{transform:translateY(4px) scale(1.12,.88)}100%{transform:translateY(0) scale(1,1)}}',
    '.pb-mascot.s-happy .pupil-group-l,.pb-mascot.s-happy .pupil-group-r{transform:translateY(4px) scaleY(.75);}',

    /* s-ask */
    '.pb-mascot.s-ask .pupil-group-l,.pb-mascot.s-ask .pupil-group-r{transform:translateX(-6px) translateY(2px);transition:transform .3s ease;}',
    '.pb-mascot.s-ask #mascot-body{animation:b-lean 3s ease-in-out infinite;}',
    '@keyframes b-lean{0%,100%{transform:translateY(0) rotate(-9deg)}50%{transform:translateY(-10px) rotate(-9deg)}}',

    /* s-ask-2 */
    '.pb-mascot.s-ask-2 .pupil-group-l,.pb-mascot.s-ask-2 .pupil-group-r{transform:translateX(6px) translateY(-2px);}',
    '.pb-mascot.s-ask-2 #mascot-body{animation:b-lean-r 3s ease-in-out infinite;}',
    '@keyframes b-lean-r{0%,100%{transform:translateY(0) rotate(8deg)}50%{transform:translateY(-9px) rotate(8deg)}}',

    /* s-ask-3 */
    '.pb-mascot.s-ask-3 .pupil-group-l,.pb-mascot.s-ask-3 .pupil-group-r{transform:translateY(-7px);}',
    '.pb-mascot.s-ask-3 #mascot-body{animation:b-float 2.2s ease-in-out infinite;}',

    /* s-working */
    '.pb-mascot.s-working #mascot-body{animation:b-work .65s ease-in-out infinite;}',
    '@keyframes b-work{0%,100%{transform:translateY(0) rotate(-5deg)}25%{transform:translateY(-9px) rotate(7deg)}75%{transform:translateY(-4px) rotate(-8deg)}}',
    '.pb-mascot.s-working .flame{animation:b-flame-work .32s ease-in-out infinite;}',
    '@keyframes b-flame-work{0%,100%{transform:scaleY(1) scaleX(1)}50%{transform:scaleY(2.1) scaleX(.65)}}',
    '.pb-mascot.s-working .pupil-group-l,.pb-mascot.s-working .pupil-group-r{transform:translateY(5px);}',

    /* s-celebrate */
    '.pb-mascot.s-celebrate #mascot-body{animation:b-celebrate .38s ease-in-out 5;}',
    '@keyframes b-celebrate{0%,100%{transform:translateY(0) scale(1) rotate(0deg)}25%{transform:translateY(-30px) scale(1.14) rotate(-8deg)}75%{transform:translateY(-22px) scale(1.14) rotate(8deg)}}',
    '.pb-mascot.s-celebrate .confetti>g{transform-box:fill-box;transform-origin:center;animation:confetti-burst 1.6s ease-out forwards;}',
    '@keyframes confetti-burst{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(80px) scale(1.8)}}',

    /* s-spin */
    '.pb-mascot.s-spin #mascot-body{animation:b-spin-full 1s cubic-bezier(.34,1.56,.64,1) both,b-float 3.2s ease-in-out infinite 1.05s;}',
    '@keyframes b-spin-full{0%{transform:rotate(0deg) scale(1)}50%{transform:rotate(200deg) scale(1.1)}85%{transform:rotate(355deg) scale(1)}100%{transform:rotate(360deg) scale(1)}}',

    /* s-tilt-left / s-tilt-right */
    '.pb-mascot.s-tilt-left  #mascot-body{animation:b-tilt-l 3.2s ease-in-out infinite;}',
    '@keyframes b-tilt-l{0%,100%{transform:rotate(-8deg) translateY(0)}50%{transform:rotate(-8deg) translateY(-10px)}}',
    '.pb-mascot.s-tilt-right #mascot-body{animation:b-tilt-r 3.2s ease-in-out infinite;}',
    '@keyframes b-tilt-r{0%,100%{transform:rotate(8deg) translateY(0)}50%{transform:rotate(8deg) translateY(-10px)}}',

    /* s-arrive-land */
    '.pb-mascot.s-arrive-land #mascot-svg{animation:b-land .7s cubic-bezier(.22,1.4,.64,1) both;}',
    '@keyframes b-land{0%{transform:translateY(-80px) scale(.8);opacity:.2}70%{transform:translateY(8px) scale(1.04);opacity:1}100%{transform:translateY(0) scale(1);opacity:1}}',

    /* Flame color system */
    '.pb-mascot.s-flame-blue  {--flame-top:#b3e5fc;--flame-mid:#0288d1;--flame-bot:#01579b;--flamein-top:#e1f5fe;--flamein-mid:#4fc3f7;--flamein-bot:#0288d1;}',
    '.pb-mascot.s-flame-green {--flame-top:#b9f6ca;--flame-mid:#00c853;--flame-bot:#1b5e20;--flamein-top:#f1fff1;--flamein-mid:#69f0ae;--flamein-bot:#00c853;}',
    '.pb-mascot.s-flame-red   {--flame-top:#ff8a80;--flame-mid:#ff1744;--flame-bot:#b71c1c;--flamein-top:#fff;--flamein-mid:#ff8a80;--flamein-bot:#ff1744;}',
    '.pb-mascot.s-flame-purple{--flame-top:#ea80fc;--flame-mid:#aa00ff;--flame-bot:#4a148c;--flamein-top:#fce4ff;--flamein-mid:#e040fb;--flamein-bot:#aa00ff;}',
    '.pb-mascot.s-flame-white {--flame-top:#fff;--flame-mid:#e0f7fa;--flame-bot:#b2ebf2;--flamein-top:#fff;--flamein-mid:#fff;--flamein-bot:#e0f7fa;}',

    /* Eye states */
    '.pb-mascot.s-eyes-up    .pupil-group-l,.pb-mascot.s-eyes-up    .pupil-group-r{transform:translateY(-9px);}',
    '.pb-mascot.s-eyes-down  .pupil-group-l,.pb-mascot.s-eyes-down  .pupil-group-r{transform:translateY(8px);}',
    '.pb-mascot.s-eyes-left  .pupil-group-l,.pb-mascot.s-eyes-left  .pupil-group-r{transform:translateX(-9px);}',
    '.pb-mascot.s-eyes-right .pupil-group-l,.pb-mascot.s-eyes-right .pupil-group-r{transform:translateX(9px);}',
    '.pb-mascot.s-eyes-roll .pupil-group-l,.pb-mascot.s-eyes-roll .pupil-group-r{animation:b-eye-roll 1.4s ease-in-out 2 both;}',
    '@keyframes b-eye-roll{0%{transform:translate(0,0)}20%{transform:translate(8px,-4px)}50%{transform:translate(0,-10px)}75%{transform:translate(-8px,-4px)}100%{transform:translate(0,0)}}',
    '.pb-mascot.s-eyes-surprise .pupil-group-l,.pb-mascot.s-eyes-surprise .pupil-group-r{animation:b-eye-surprise 1s ease both;}',
    '@keyframes b-eye-surprise{0%{transform:translateY(0)}15%{transform:translateY(-12px)}65%{transform:translateY(-12px)}100%{transform:translateY(0)}}',

    /* Nose variants */
    '.pb-mascot.s-nose-spin   .mascot-nose{animation:b-nose-spin  .7s cubic-bezier(.34,1.56,.64,1) 1 both;}',
    '@keyframes b-nose-spin{0%{transform:rotate(0deg)}55%{transform:rotate(210deg)}100%{transform:rotate(360deg)}}',
    '.pb-mascot.s-nose-spin-l .mascot-nose{animation:b-nose-spin-l 1.1s linear infinite;}',
    '@keyframes b-nose-spin-l{0%{transform:rotate(0deg)}100%{transform:rotate(-360deg)}}',
    '.pb-mascot.s-nose-spin-r .mascot-nose{animation:b-nose-spin-r 1.1s linear infinite;}',
    '@keyframes b-nose-spin-r{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}',
    '.pb-mascot.s-nose-pop-slow .mascot-nose{animation:b-nose-pop-slow 1.5s cubic-bezier(.34,1.56,.64,1) 1 both;}',
    '@keyframes b-nose-pop-slow{0%{transform:translateY(0)}35%{transform:translateY(-32px)}100%{transform:translateY(0)}}',
    '.pb-mascot.s-nose-pop-fast .mascot-nose{animation:b-nose-pop-fast .45s cubic-bezier(.34,1.56,.64,1) 1 both;}',
    '@keyframes b-nose-pop-fast{0%{transform:translateY(0)}40%{transform:translateY(-22px)}100%{transform:translateY(0)}}',

    /* Nose beacon */
    '.pb-mascot.s-light-nose #mascot-nose-light{opacity:.9;animation:b-beacon 1.8s ease-in-out infinite;}',
    '@keyframes b-beacon{0%,75%,100%{opacity:.9}40%{opacity:.1}}',

    /* Waist lights */
    '.pb-mascot.s-lights-pulse .w-light{animation:b-light-pulse 1.1s ease-in-out infinite;}',
    '@keyframes b-light-pulse{0%,100%{opacity:.9}50%{opacity:.15}}',
    '.pb-mascot.s-lights-sequence .w-light:nth-child(1){animation:b-light-seq 1.4s 0.0s ease-in-out infinite}',
    '.pb-mascot.s-lights-sequence .w-light:nth-child(2){animation:b-light-seq 1.4s 0.2s ease-in-out infinite}',
    '.pb-mascot.s-lights-sequence .w-light:nth-child(3){animation:b-light-seq 1.4s 0.4s ease-in-out infinite}',
    '.pb-mascot.s-lights-sequence .w-light:nth-child(4){animation:b-light-seq 1.4s 0.6s ease-in-out infinite}',
    '.pb-mascot.s-lights-sequence .w-light:nth-child(5){animation:b-light-seq 1.4s 0.8s ease-in-out infinite}',
    '.pb-mascot.s-lights-sequence .w-light:nth-child(6){animation:b-light-seq 1.4s 1.0s ease-in-out infinite}',
    '.pb-mascot.s-lights-sequence .w-light:nth-child(7){animation:b-light-seq 1.4s 1.2s ease-in-out infinite}',
    '@keyframes b-light-seq{0%,100%{opacity:.1}50%{opacity:1}}',
    '.pb-mascot.s-lights-flash .w-light{animation:b-light-flash .28s ease-in-out 6;}',
    '@keyframes b-light-flash{0%,100%{opacity:0}50%{opacity:1}}',

    /* Smoke (all variants) */
    '.pb-mascot.s-smoke .smoke-puff{animation:b-smoke 1.4s ease-out forwards;transform-box:fill-box;transform-origin:center;}',
    '.pb-mascot.s-smoke .smoke-puff:nth-child(1){animation-delay:0s}',
    '.pb-mascot.s-smoke .smoke-puff:nth-child(2){animation-delay:.18s}',
    '.pb-mascot.s-smoke .smoke-puff:nth-child(3){animation-delay:.36s}',
    '@keyframes b-smoke{0%{opacity:.7;transform:scale(.15) translateY(0)}35%{opacity:.5;transform:scale(1.5) translateY(-20px)}100%{opacity:0;transform:scale(2.8) translateY(-55px)}}',
    '.pb-mascot.s-smoke-sm .smoke-puff:nth-child(1){animation:b-smoke-sm 1.2s ease-out forwards;transform-box:fill-box;transform-origin:center;}',
    '.pb-mascot.s-smoke-sm .smoke-puff:nth-child(2),.pb-mascot.s-smoke-sm .smoke-puff:nth-child(3){animation:none;}',
    '@keyframes b-smoke-sm{0%{opacity:.7;transform:scale(.15) translateY(0)}40%{opacity:.5;transform:scale(.9) translateY(-12px)}100%{opacity:0;transform:scale(1.6) translateY(-30px)}}',
    '.pb-mascot.s-smoke-lg .smoke-puff:nth-child(1){animation:b-smoke-lg 1.9s ease-out forwards;transform-box:fill-box;transform-origin:center;}',
    '.pb-mascot.s-smoke-lg .smoke-puff:nth-child(2),.pb-mascot.s-smoke-lg .smoke-puff:nth-child(3){animation:none;}',
    '@keyframes b-smoke-lg{0%{opacity:.85;transform:scale(.15) translateY(0)}30%{opacity:.6;transform:scale(2.2) translateY(-22px)}100%{opacity:0;transform:scale(4.2) translateY(-65px)}}',
    '.pb-mascot.s-smoke-2 .smoke-puff:nth-child(1){animation:b-smoke 1.4s ease-out forwards;transform-box:fill-box;transform-origin:center;animation-delay:0s;}',
    '.pb-mascot.s-smoke-2 .smoke-puff:nth-child(2){animation:b-smoke 1.4s ease-out forwards;transform-box:fill-box;transform-origin:center;animation-delay:.18s;}',
    '.pb-mascot.s-smoke-2 .smoke-puff:nth-child(3){animation:none;}',
    '.pb-mascot.s-smoke-3 .smoke-puff{animation:b-smoke 1.4s ease-out forwards;transform-box:fill-box;transform-origin:center;}',
    '.pb-mascot.s-smoke-3 .smoke-puff:nth-child(1){animation-delay:0s}',
    '.pb-mascot.s-smoke-3 .smoke-puff:nth-child(2){animation-delay:.18s}',
    '.pb-mascot.s-smoke-3 .smoke-puff:nth-child(3){animation-delay:.36s}'
  ].join('\n');

  /* ── SVG ──────────────────────────────────────────────────────────────── */
  var SVG = '<svg id="mascot-svg" viewBox="0 0 360 460" xmlns="http://www.w3.org/2000/svg">'
    + '<defs>'
    + '<linearGradient id="mc-bf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".48" stop-color="#f8fbff"/><stop offset="1" stop-color="#dbe6f2"/></linearGradient>'
    + '<linearGradient id="mc-bs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff" stop-opacity=".94"/><stop offset=".64" stop-color="#ffffff" stop-opacity=".08"/><stop offset="1" stop-color="#8ea4bc" stop-opacity=".34"/></linearGradient>'
    + '<linearGradient id="mc-rf" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="#ff5a4f"/><stop offset=".48" stop-color="#ff2f2f"/><stop offset="1" stop-color="#d70f22"/></linearGradient>'
    + '<linearGradient id="mc-gf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ee33f"/><stop offset=".5" stop-color="#49bf24"/><stop offset="1" stop-color="#238b19"/></linearGradient>'
    + '<radialGradient id="mc-ef" cx=".35" cy=".25" r=".9"><stop offset="0" stop-color="#ffffff"/><stop offset=".15" stop-color="#deffd8"/><stop offset=".58" stop-color="#65d84a"/><stop offset="1" stop-color="#1b8e2b"/></radialGradient>'
    + '<linearGradient id="mc-fo" x1=".5" y1="0" x2=".5" y2="1"><stop offset="0" style="stop-color:var(--flame-top,#ffdc2f)"/><stop offset=".46" style="stop-color:var(--flame-mid,#ff961f)"/><stop offset="1" style="stop-color:var(--flame-bot,#ef3d10)"/></linearGradient>'
    + '<linearGradient id="mc-fi" x1=".5" y1="0" x2=".5" y2="1"><stop offset="0" style="stop-color:var(--flamein-top,#fffbd7)"/><stop offset=".55" style="stop-color:var(--flamein-mid,#fff04c)"/><stop offset="1" style="stop-color:var(--flamein-bot,#ffac20)"/></linearGradient>'
    + '<clipPath id="mc-bc"><path d="M180 42 C117 89 89 163 91 251 C92 309 119 348 180 378 C241 348 268 309 269 251 C271 163 243 89 180 42Z"/></clipPath>'
    + '</defs>'
    /* Confetti */
    + '<g class="confetti" id="mascot-effects">'
    + '<g fill="none" stroke="#76b8ff" stroke-width="7" stroke-linecap="round" opacity="0"><path d="M64 272 Q48 294 61 319"/><path d="M47 260 Q24 292 43 329"/></g>'
    + '<g fill="none" stroke="#76b8ff" stroke-width="7" stroke-linecap="round" opacity="0"><path d="M296 272 Q312 294 299 319"/><path d="M313 260 Q336 292 317 329"/></g>'
    + '<g opacity="0"><path d="M53 102 l5 13 13 5-13 5-5 13-5-13-13-5 13-5z" fill="#ffd12f"/><path d="M305 94 l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" fill="#62dd43"/><circle cx="67" cy="164" r="5" fill="#ff5a4f"/><circle cx="300" cy="168" r="5" fill="#ff9f1c"/></g>'
    + '<g opacity="0"><rect x="30" y="160" width="9" height="20" rx="3" fill="#ff3c35" transform="rotate(-26 34 170)"/><rect x="313" y="179" width="9" height="20" rx="3" fill="#52ce34" transform="rotate(22 317 189)"/><rect x="56" y="226" width="9" height="20" rx="3" fill="#ffc228" transform="rotate(32 60 236)"/><rect x="294" y="232" width="9" height="20" rx="3" fill="#44a9ff" transform="rotate(-28 298 242)"/><circle cx="37" cy="285" r="6" fill="#43d355"/><circle cx="325" cy="287" r="6" fill="#ff4b3e"/></g>'
    + '</g>'
    /* Shadow */
    + '<ellipse cx="180" cy="434" rx="72" ry="13" fill="#000" opacity=".18"/>'
    /* Body group */
    + '<g id="mascot-body">'
    /* Flame */
    + '<g id="mascot-exhaust" class="flame">'
    + '<path d="M180 354 C213 385 207 419 180 446 C153 419 147 385 180 354Z" fill="url(#mc-fo)" stroke="#102957" stroke-width="8" stroke-linejoin="round"/>'
    + '<path d="M180 368 C197 389 194 411 180 428 C166 411 163 389 180 368Z" fill="url(#mc-fi)"/>'
    + '</g>'
    /* Fins */
    + '<path d="M103 240 C68 254 46 286 48 327 C74 312 97 298 116 276Z" fill="url(#mc-rf)" stroke="#102957" stroke-width="9" stroke-linejoin="round"/>'
    + '<path d="M257 240 C292 254 314 286 312 327 C286 312 263 298 244 276Z" fill="url(#mc-rf)" stroke="#102957" stroke-width="9" stroke-linejoin="round"/>'
    + '<path d="M97 258 C78 271 67 288 61 307" fill="none" stroke="#ff7d72" stroke-width="6" stroke-linecap="round" opacity=".8"/>'
    + '<path d="M263 258 C282 271 293 288 299 307" fill="none" stroke="#ff7d72" stroke-width="6" stroke-linecap="round" opacity=".8"/>'
    /* Hull */
    + '<path d="M180 42 C117 89 89 163 91 251 C92 309 119 348 180 378 C241 348 268 309 269 251 C271 163 243 89 180 42Z" fill="url(#mc-bf)" stroke="#102957" stroke-width="10" stroke-linejoin="round"/>'
    + '<g clip-path="url(#mc-bc)">'
    + '<path d="M184 36 C138 106 128 245 149 342 C126 329 107 307 98 278 C77 209 103 104 180 42Z" fill="#fff" opacity=".88"/>'
    + '<path d="M231 76 C265 135 278 240 246 315 C232 340 210 359 180 377 C207 285 214 168 184 43Z" fill="url(#mc-bs)" opacity=".75"/>'
    + '<path d="M93 269 C121 289 148 299 180 299 C212 299 239 289 267 269 L265 301 C239 319 211 327 180 327 C149 327 121 319 95 301Z" fill="url(#mc-gf)" stroke="#102957" stroke-width="8"/>'
    + '<path d="M105 283 C132 298 156 304 180 304 C204 304 228 298 255 283" fill="none" stroke="#b3ff70" stroke-width="5" opacity=".8"/>'
    + '</g>'
    /* Nose (independent spin) */
    + '<g id="mascot-nose" class="mascot-nose" style="transform-box:fill-box;transform-origin:180px 100px">'
    + '<path d="M180 42 C151 64 129 88 113 116 C137 105 157 100 180 100 C203 100 223 105 247 116 C231 88 209 64 180 42Z" fill="url(#mc-rf)" stroke="#102957" stroke-width="9" stroke-linejoin="round"/>'
    + '<path d="M205 56 C220 72 229 85 236 102" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".9"/>'
    + '<circle id="mascot-nose-light" cx="180" cy="50" r="8" fill="#ffdc2f" opacity="0"/>'
    + '</g>'
    /* Eyes */
    + '<path d="M126 161 Q145 146 160 158" fill="none" stroke="#102957" stroke-width="8" stroke-linecap="round"/>'
    + '<path d="M200 158 Q216 146 234 161" fill="none" stroke="#102957" stroke-width="8" stroke-linecap="round"/>'
    + '<ellipse cx="145" cy="196" rx="29" ry="37" fill="#fff" stroke="#102957" stroke-width="7"/>'
    + '<g class="pupil-group-l" style="transition:transform .3s ease"><ellipse cx="148" cy="200" rx="18" ry="24" fill="url(#mc-ef)" stroke="#102957" stroke-width="5"/><ellipse cx="151" cy="202" rx="8" ry="13" fill="#071329"/><circle cx="143" cy="190" r="6" fill="#fff"/><circle cx="155" cy="211" r="3" fill="#fff" opacity=".8"/></g>'
    + '<ellipse cx="215" cy="196" rx="29" ry="37" fill="#fff" stroke="#102957" stroke-width="7"/>'
    + '<g class="pupil-group-r" style="transition:transform .3s ease"><ellipse cx="212" cy="200" rx="18" ry="24" fill="url(#mc-ef)" stroke="#102957" stroke-width="5"/><ellipse cx="209" cy="202" rx="8" ry="13" fill="#071329"/><circle cx="204" cy="190" r="6" fill="#fff"/><circle cx="216" cy="211" r="3" fill="#fff" opacity=".8"/></g>'
    /* Cheeks */
    + '<ellipse cx="121" cy="244" rx="15" ry="8" fill="#ff7272" opacity=".55"/>'
    + '<ellipse cx="239" cy="244" rx="15" ry="8" fill="#ff7272" opacity=".55"/>'
    /* Mouths */
    + '<g id="mouths">'
    + '<path class="mouth-happy" d="M145 238 Q180 270 215 238 Q208 286 180 291 Q152 286 145 238Z" fill="#102957"/>'
    + '<path class="mouth-happy" d="M162 273 Q180 287 198 273 Q187 269 180 270 Q173 269 162 273Z" fill="#ff4d57"/>'
    + '<ellipse class="mouth-working" cx="180" cy="259" rx="17" ry="21" fill="#102957"/>'
    + '<ellipse class="mouth-working" cx="180" cy="268" rx="10" ry="6" fill="#ff4d57"/>'
    + '<ellipse class="mouth-celebrate" cx="180" cy="258" rx="26" ry="32" fill="#102957"/>'
    + '<path class="mouth-celebrate" d="M161 274 Q180 289 199 274 Q180 267 161 274Z" fill="#ff4d57"/>'
    + '<path class="mouth-ask" d="M163 260 Q180 268 197 260" fill="none" stroke="#102957" stroke-width="8" stroke-linecap="round"/>'
    + '</g>'
    /* Badge */
    + '<g id="mascot-badge"><circle cx="180" cy="316" r="29" fill="#102957"/><circle cx="180" cy="316" r="23" fill="url(#mc-gf)" stroke="#b9ff78" stroke-width="4"/><path d="M169 299 H183 C198 299 202 314 192 320 C202 325 198 337 183 337 H169Z" fill="#fff"/><path d="M177 306 H184 C191 306 191 314 184 314 H177ZM177 321 H185 C192 321 192 329 185 329 H177Z" fill="#2c9e1d"/></g>'
    /* Waist lights */
    + '<g id="mascot-lights-waist"><circle class="w-light" cx="122" cy="289" r="5" fill="#39ff14" opacity="0"/><circle class="w-light" cx="140" cy="296" r="5" fill="#39ff14" opacity="0"/><circle class="w-light" cx="160" cy="300" r="5" fill="#39ff14" opacity="0"/><circle class="w-light" cx="180" cy="301" r="5" fill="#39ff14" opacity="0"/><circle class="w-light" cx="200" cy="300" r="5" fill="#39ff14" opacity="0"/><circle class="w-light" cx="220" cy="296" r="5" fill="#39ff14" opacity="0"/><circle class="w-light" cx="238" cy="289" r="5" fill="#39ff14" opacity="0"/></g>'
    /* Arms */
    + '<g id="mascot-arms">'
    + '<g class="mascot-arm mascot-arm-wave" opacity="0"><path d="M113 261 C84 253 73 229 82 207" fill="none" stroke="#102957" stroke-width="19" stroke-linecap="round"/><path d="M113 261 C84 253 73 229 82 207" fill="none" stroke="#f8fbff" stroke-width="11" stroke-linecap="round"/><g transform="translate(78 199) rotate(-18)"><circle cx="0" cy="0" r="16" fill="#fff" stroke="#102957" stroke-width="6"/><path d="M-12 -7 L-22 -22 M-4 -13 L-7 -31 M5 -13 L10 -31 M12 -8 L23 -22" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/><path d="M-12 -7 L-22 -22 M-4 -13 L-7 -31 M5 -13 L10 -31 M12 -8 L23 -22" fill="none" stroke="#102957" stroke-width="4" stroke-linecap="round"/></g></g>'
    + '<g class="mascot-arm mascot-arm-point" opacity="0"><path d="M247 259 C277 250 292 235 307 220" fill="none" stroke="#102957" stroke-width="19" stroke-linecap="round"/><path d="M247 259 C277 250 292 235 307 220" fill="none" stroke="#f8fbff" stroke-width="11" stroke-linecap="round"/><g transform="translate(311 216) rotate(-20)"><circle cx="0" cy="0" r="15" fill="#fff" stroke="#102957" stroke-width="6"/><path d="M9 -3 L34 -11" fill="none" stroke="#102957" stroke-width="11" stroke-linecap="round"/><path d="M9 -3 L34 -11" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/></g></g>'
    + '</g>'
    + '</g>' /* end #mascot-body */
    /* Smoke (outside float group) */
    + '<g id="mascot-smoke"><ellipse class="smoke-puff" cx="180" cy="415" rx="2" ry="2" fill="#c8c8c8" opacity="0"/><ellipse class="smoke-puff" cx="158" cy="428" rx="2" ry="2" fill="#b8b8b8" opacity="0"/><ellipse class="smoke-puff" cx="202" cy="422" rx="2" ry="2" fill="#d0d0d0" opacity="0"/></g>'
    + '</svg>';

  /* ── DATA ─────────────────────────────────────────────────────────────── */
  var DEFAULT_ANIM = {
    's-wave':        { flame: 's-flame-green',  lights: 's-lights-sequence' },
    's-wave-2':      { flame: 's-flame-green',  lights: 's-lights-sequence', noseSpin: 's-nose-spin-r' },
    's-ask':         {},
    's-ask-2':       {},
    's-ask-3':       { lights: 's-lights-pulse' },
    's-happy':       { flame: 's-flame-green',  noseSpin: 's-nose-spin-r' },
    's-working':     { flame: 's-flame-blue',   lights: 's-lights-pulse' },
    's-celebrate':   { flame: 's-flame-green',  lights: 's-lights-flash',    smoke: 's-smoke-3' },
    's-spin':        { flame: 's-flame-purple', noseSpin: 's-nose-spin-r' },
    's-tilt-left':   { eyes: 's-eyes-left' },
    's-tilt-right':  { eyes: 's-eyes-right' },
    's-arrive-land': { flame: 's-flame-blue',   lights: 's-lights-pulse' }
  };

  var MOOD_CAPTIONS = {
    's-wave':        'Hey there! 👋',
    's-wave-2':      'So great to meet you! 🚀',
    's-ask':         'Tell me more...',
    's-ask-2':       'Hmm, interesting...',
    's-ask-3':       'I have a question!',
    's-happy':       'Looking good! 🎉',
    's-working':     'On it...',
    's-celebrate':   "Let's blast! 🚀",
    's-spin':        'Woohoo! 🌀',
    's-tilt-left':   'Thinking...',
    's-tilt-right':  'Almost there...',
    's-arrive-land': 'Landed! 🛬'
  };

  /* ── API ──────────────────────────────────────────────────────────────── */

  /* setMood(moodOrSpec)
     moodOrSpec: string like 's-wave'
              OR object { mood, flame, lights, eyes, smoke, noseSpin }
     Applies arrive animation, then settles into final state.
  */
  function setMood(moodOrSpec) {
    var spec   = typeof moodOrSpec === 'string' ? { mood: moodOrSpec } : (moodOrSpec || { mood: 's-ask' });
    var mood   = spec.mood || 's-ask';
    var merged = Object.assign({}, DEFAULT_ANIM[mood] || {}, spec);
    var extra  = [
      merged.eyes || '',
      merged.flame || '',
      merged.lights || '',
      merged.smoke === true ? 's-smoke-3' : (merged.smoke || ''),
      merged.noseSpin === true ? 's-nose-spin-r' : (merged.noseSpin || ''),
      merged.mouth || ''
    ].filter(Boolean);
    var el = document.getElementById('pb-mascot');
    if (!el) return;
    el.className = 'pb-mascot s-arrive';
    void el.offsetWidth;
    el.className = ['pb-mascot', 's-arrive', mood].concat(extra).join(' ');
    setTimeout(function () {
      if (el.className.indexOf(mood) !== -1)
        el.className = ['pb-mascot', mood].concat(extra).join(' ');
    }, 500);
    var cap = document.getElementById('pb-mascot-caption');
    if (cap) cap.textContent = MOOD_CAPTIONS[mood] || '';
  }

  /* setPosition(pos) — 'left' | 'right' | null */
  function setPosition(pos) {
    var zone = document.getElementById('pb-mascot-zone');
    if (!zone) return;
    zone.classList.remove('mascot-pos-left', 'mascot-pos-right');
    if (pos) zone.classList.add('mascot-pos-' + pos);
  }

  /* miniSVG(mood) — simplified inline avatar for chat bubbles */
  function miniSVG(mood) {
    var py = { 's-ask': 204, 's-working': 207, 's-wave': 198, 's-happy': 205, 's-celebrate': 198 }[mood] || 202;
    return '<svg viewBox="0 0 360 460" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M180 354 C213 385 207 419 180 446 C153 419 147 385 180 354Z" fill="#ff8c1a"/>'
      + '<path d="M103 240 C68 254 46 286 48 327 C74 312 97 298 116 276Z" fill="#ff2f2f" stroke="#102957" stroke-width="9"/>'
      + '<path d="M257 240 C292 254 314 286 312 327 C286 312 263 298 244 276Z" fill="#ff2f2f" stroke="#102957" stroke-width="9"/>'
      + '<path d="M180 42 C117 89 89 163 91 251 C92 309 119 348 180 378 C241 348 268 309 269 251 C271 163 243 89 180 42Z" fill="#f0f6ff" stroke="#102957" stroke-width="10"/>'
      + '<path d="M93 269 C121 289 148 299 180 299 C212 299 239 289 267 269 L265 301 C239 319 211 327 180 327 C149 327 121 319 95 301Z" fill="#49bf24" stroke="#102957" stroke-width="8"/>'
      + '<path d="M180 42 C151 64 129 88 113 116 C137 105 157 100 180 100 C203 100 223 105 247 116 C231 88 209 64 180 42Z" fill="#ff2f2f" stroke="#102957" stroke-width="9"/>'
      + '<ellipse cx="145" cy="196" rx="29" ry="37" fill="#fff" stroke="#102957" stroke-width="7"/>'
      + '<ellipse cx="148" cy="' + (py - 2) + '" rx="16" ry="22" fill="#49d834"/>'
      + '<ellipse cx="151" cy="' + py + '" rx="8" ry="13" fill="#071329"/>'
      + '<circle cx="143" cy="190" r="5" fill="#fff"/>'
      + '<ellipse cx="215" cy="196" rx="29" ry="37" fill="#fff" stroke="#102957" stroke-width="7"/>'
      + '<ellipse cx="212" cy="' + (py - 2) + '" rx="16" ry="22" fill="#49d834"/>'
      + '<ellipse cx="209" cy="' + py + '" rx="8" ry="13" fill="#071329"/>'
      + '<circle cx="204" cy="190" r="5" fill="#fff"/>'
      + '<ellipse cx="121" cy="244" rx="15" ry="8" fill="#ff7272" opacity=".55"/>'
      + '<ellipse cx="239" cy="244" rx="15" ry="8" fill="#ff7272" opacity=".55"/>'
      + '<path d="M155 248 Q180 265 205 248" stroke="#102957" stroke-width="9" fill="none" stroke-linecap="round"/>'
      + '</svg>';
  }

  /* ── INJECT ───────────────────────────────────────────────────────────── */
  function injectCSS() {
    if (document.getElementById('pb-mascot-css')) return;
    var s = document.createElement('style');
    s.id = 'pb-mascot-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function injectSVG() {
    var el = document.getElementById('pb-mascot');
    if (!el || el.querySelector('svg')) return;
    el.innerHTML = SVG;
  }

  function init() {
    injectCSS();
    injectSVG();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ── EXPORT ───────────────────────────────────────────────────────────── */
  window.PBMascot = {
    setMood: setMood,
    setPosition: setPosition,
    miniSVG: miniSVG,
    DEFAULT_ANIM: DEFAULT_ANIM,
    MOOD_CAPTIONS: MOOD_CAPTIONS,
    injectSVG: injectSVG
  };

})();
