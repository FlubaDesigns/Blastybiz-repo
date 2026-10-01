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
  root.BBPhotoHandoff = {prepare, canShare, share, copy, save};
})(globalThis);
