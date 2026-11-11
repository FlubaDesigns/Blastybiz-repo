/* One display renderer for saved previews and the clearly labeled public example. */
(function(root){
  root.BBPostPreview = { render({meta={},text='',images=[],isAuto=false,bizName='Your business',pid='',status='',copy=true,photoAlt='',eager=false}) {
    const imgs=images.filter(url=>{try {return ['https:','http:'].includes(new URL(url,document.baseURI || location.href).protocol);}catch(_){return false;}});
  var media;
  if (imgs.length) {
    media = '<div class="pub-post-photo"><img src="' + escHtml(imgs[0]) + '" alt="' + escHtml(photoAlt) + '" loading="' + (eager ? 'eager' : 'lazy') + '" /></div>';
  } else {
    // A blast with no photo still publishes fine, so this is a nudge, not an error.
    media = '<div class="pub-post-nophoto">'
      + '<div class="pub-post-nophoto-icon">🖼</div>'
      + '<div class="pub-post-nophoto-title">No photo on this blast</div>'
      + '<div class="pub-post-nophoto-sub">Posts with a photo get noticeably more attention. You can still publish without one.</div>'
      + '</div>';
  }

  var thumbs = imgs.length > 1
    ? '<div class="pub-post-thumbs">' + imgs.slice(1).map(function (url) {
        var safe = escHtml(url);
        return '<a class="pub-post-thumb" href="' + safe + '" target="_blank" rel="noopener noreferrer">'
          + '<img src="' + safe + '" alt="" loading="lazy" /></a>';
      }).join('') + '</div>'
    : '';

  return '<div class="pub-post">'
    + '<div class="pub-post-hdr">'
    +   '<div class="pub-post-avatar">' + escHtml(meta.icon) + '</div>'
    +   '<div class="pub-post-hdr-body">'
    +     '<div class="pub-post-biz">' + escHtml(bizName) + '</div>'
    +     '<div class="pub-post-meta">' + escHtml(meta.name) + ' · ' + escHtml(status || (isAuto ? 'Blasty Posts It' : 'Ready for You to Post')) + '</div>'
    +   '</div>'
    + '</div>'
    + media
    + '<div class="pub-post-text">' + escHtml(text) + '</div>'
    + thumbs
    + '<div class="pub-post-foot">'
    +   '<span class="pub-post-count">' + text.length + ' characters</span>'
    +   (copy ? '<button class="pub-copy-btn" data-rail-copy="' + escHtml(pid) + '">📋 Copy</button>' : '')
    + '</div>'
    + '</div>';
  }};
})(window);
