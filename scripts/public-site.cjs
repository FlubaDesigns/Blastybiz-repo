'use strict';
// Canonical public origin and crawlable routes. Auth and admin pages stay out.
const ORIGIN='https://blastybiz.com';
const MARKETING=new Set(['Home','About','Contact','AI','Platforms','Plan-Free','Plan-Pro','Plan-Agency','Privacy','Terms','Be-Johnny','Stop-Paying-Johnny']);
const isPublic=file=>/^BlastyBiz-Platform-[a-z]+\.html$/.test(file)||MARKETING.has(file.replace(/^BlastyBiz-/,'').replace(/\.html$/,''));
const canonical=file=>ORIGIN+'/'+file.replace(/\.html$/,'');
module.exports={ORIGIN,isPublic,canonical};
