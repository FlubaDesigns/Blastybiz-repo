/* Phone handoff uses the actual image bytes, never a link in place of a photo. */
(function(root) {
  'use strict';
  const cache = new Map();
  function photoBlob(url) {
    if (cache.has(url)) return cache.get(url);
    const pending = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(url, {signal:controller.signal});
        if (!response.ok) throw new Error('Photo could not be downloaded.');
        const blob = await response.blob();
        if (!blob.size || !/^image\/(jpeg|png|webp|gif)$/i.test(blob.type)) throw new Error('Photo is unavailable.');
        return blob;
      } finally { clearTimeout(timeout); }
    })();
    cache.set(url, pending);
    pending.catch(() => { if (cache.get(url) === pending) cache.delete(url); });
    // Bound memory when moving between many saved blasts.
    if (cache.size > 30) cache.delete(cache.keys().next().value);
    return pending;
  }
  const extension = blob => blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1];
  async function prepare(urls, platform) {
    const blobs = await Promise.all(urls.map(photoBlob));
    const prefix = String(platform || 'photo').replace(/[^a-z0-9_-]/gi, '-');
    return blobs.map((blob, i) => new File([blob], 'blastybiz-' + prefix + '-' + (i + 1) + '.' + extension(blob), {type:blob.type}));
  }
  function canShare(files) {
    try { return !!(files.length && navigator.share && navigator.canShare && navigator.canShare({files})); }
    catch (error) { return false; }
  }
  function share(files, text) {
    if (!canShare(files)) return Promise.reject(new Error('Use Copy photo or Save photo on this browser.'));
    // Call from the ready button's click, without fetching first: the phone
    // requires a fresh user gesture to open its share sheet.
    return navigator.share({files, ...(text ? {text} : {})});
  }
  async function pngBlob(url) {
    const blob = await photoBlob(url);
    if (blob.type === 'image/png') return blob;
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      return await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Could not copy this photo.')), 'image/png'));
    } finally { bitmap.close(); }
  }
  function copy(url) {
    if (!navigator.clipboard?.write || !root.ClipboardItem) return Promise.reject(new Error('Use Share photos or Save photo on this browser.'));
    // Passing the blob promise preserves the clipboard click gesture too.
    return navigator.clipboard.write([new ClipboardItem({'image/png':pngBlob(url)})]);
  }
  async function save(url, platform, index) {
    const blob = await photoBlob(url);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'blastybiz-' + String(platform || 'photo').replace(/[^a-z0-9_-]/gi, '-') + '-' + (index + 1) + '.' + extension(blob);
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  }
  function renderPhotos(host, pid, photos, displayOnly = false) {
    host.replaceChildren(); host.classList.add('bb-photo-tools');
    const feedback = document.createElement('p'); feedback.className='bb-photo-feedback'; feedback.setAttribute('role','status');
    const grid = document.createElement('div'); grid.className='bb-photo-grid'; host.append(grid,feedback);
    photos.forEach((photo,index)=>{
      const item=document.createElement('div');item.className='qp-photo-item';
      const link=document.createElement('a');link.href=photo.url;link.target='_blank';link.rel='noopener';link.className='platform-photo qp-thumb';
      const img=document.createElement('img');img.src=photo.url;img.alt=photo.alt||'Photo '+(index+1);img.loading='lazy';img.width=72;img.height=72;
      const label=document.createElement('span');label.textContent='Photo '+(index+1);link.append(img,label);item.append(link);
      if(!displayOnly){
        const actions=document.createElement('div');actions.className='qp-photo-tools';
        for(const [label,action,done] of [
          ['Copy photo',()=>copy(photo.url),'Photo copied — paste it into your post.'],
          ['Save photo',()=>save(photo.url,pid,index),'Download started — choose the photo from Recent.']
        ]){
          const button=document.createElement('button');button.type='button';button.textContent=label;
          button.onclick=()=>{button.disabled=true;feedback.textContent=label+'…';
            action().then(()=>{feedback.textContent=done;}).catch(()=>{feedback.textContent='Use Share photos, or open the photo above and hold it to save.';}).finally(()=>{button.disabled=false;});};
          actions.append(button);
        }
        item.append(actions);
      }
      grid.append(item);
    });
  }

function renderShare(host, pid, photos, getText = () => '') {
  if (!host) return;
  host.innerHTML = ''; host.style.display = photos.length ? 'block' : 'none';
  if (!photos.length) return;
  const button = document.createElement('button'); button.type = 'button';
  const status = document.createElement('div'); status.className = 'qp-photo-share-status'; status.setAttribute('role', 'status');
  host.append(button, status);
  let readyFiles = [], busy = false;
  const prepare = async () => {
    button.disabled = true; button.textContent = 'Preparing photos…';
    status.textContent = 'Getting these photos ready for your phone.';
    try {
      const files = await BBPhotoHandoff.prepare(photos.map(photo => photo.url), pid);
      if (!host.isConnected || button.parentNode !== host) return;
      readyFiles = files;
      if (BBPhotoHandoff.canShare(files)) {
        button.textContent = 'Share ' + files.length + (files.length === 1 ? ' photo' : ' photos'); button.disabled = false;
        status.textContent = 'Choose the app in your phone’s share menu. If the caption does not carry over, use Copy text above.';
      } else {
        button.hidden = true;
        status.textContent = 'Use Copy photo below and paste into your post. If the app does not accept pasted images, use Save photo, then choose it from Recent.';
      }
    } catch (error) {
      if (!host.isConnected || button.parentNode !== host) return;
      button.disabled = false; button.textContent = 'Retry preparing photos';
      status.textContent = 'Could not load the photos for sharing. Retry, or use Open photo below.';
    }
  };
  button.onclick = () => {
    if (busy) return;
    if (!readyFiles.length) { prepare(); return; }
    busy = true; button.disabled = true;
    const text = getText();
    BBPhotoHandoff.share(readyFiles, text).then(() => {
      status.textContent = 'Handed to your phone. Finish posting in the selected app.';
    }).catch(error => {
      if (error.name !== 'AbortError') status.textContent = 'The phone could not share these photos. Use Copy photo or Save photo below.';
    }).finally(() => { busy = false; button.disabled = false; });
  };
  prepare();
}

  root.BBPhotoHandoff = {prepare, canShare, share, copy, save, renderShare, renderPhotos};
})(globalThis);
