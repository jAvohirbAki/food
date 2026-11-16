(() => {
  const current = /\/(admin|owner)(\.html)?\/?$/.test(location.pathname) ? 'owner' : /\/courier(\.html)?\/?$/.test(location.pathname) ? 'courier' : 'customer';
  const nav = document.createElement('nav');
  nav.className = 'birga-panels';
  nav.setAttribute('aria-label', 'BIRGA panellari');
  nav.innerHTML = '<b>BIRGA</b>' + [['customer', '/', 'Xaridor'], ['owner', '/admin', 'Biznes egasi'], ['courier', '/courier', 'Kuryer']].map(([role, href, label]) => `<a href="${href}" ${role === current ? 'aria-current="page"' : ''}>${label}</a>`).join('');
  document.body.prepend(nav);
  document.body.classList.add('birga-connected');
})();
