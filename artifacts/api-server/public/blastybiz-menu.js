window.toggleMenu = function() {
  var m = document.getElementById('header__mobile-menu');
  if (m) m.classList.toggle('open');
};
window.closeMenu = function() {
  var m = document.getElementById('header__mobile-menu');
  if (m) m.classList.remove('open');
};
document.addEventListener('click', function(e) {
  var menu = document.getElementById('header__mobile-menu');
  var btn  = document.getElementById('header__hamburger-btn');
  if (!menu || !btn) return;
  if (menu.classList.contains('open') && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.classList.remove('open');
  }
}, true);
