(function(root) {
  'use strict';
  function normalize(value) {
    const v=String(value || '').trim();
    return !v || /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : 'https://' + v.replace(/^\/\//,'');
  }
  function error(value, required) {
    const v=normalize(value);
    if(!v)return required ? 'Please enter your business website.' : '';
    try {
      const u=new URL(v);
      if(!['http:','https:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.')||/\s/.test(v))throw Error();
      return '';
    } catch(_) { return 'Please enter a valid http or https website, such as example.com.'; }
  }
  root.BBWebsite={normalize,error};
})(globalThis);
