(() => {
  const page = document.body.dataset.adminPage || 'overview';
  const pageInfo = {
    overview: ['Shop overview', 'Your shop at a glance.'],
    inventory: ['Product inventory', 'Find, edit and manage the products in your catalog.'],
    orders: ['Order management', 'Review orders and keep customers updated on delivery.'],
    reviews: ['Customer reviews', 'Manage feedback left on your products.'],
    'product-editor': ['Add a product', 'Create a product listing in a few guided steps.'],
    subscribers: ['Newsletter subscribers', 'View customers who signed up for PennyBuys updates.'],
    commercials: ['Commercials', 'Set up customer offers and delivery promotions.']
  };
  const sectionByPage = {
    overview: 'overview-section', inventory: 'inventory-section', orders: 'order-section',
    reviews: 'review-section', 'product-editor': 'product-editor', subscribers: 'newsletter-subscribers',
    commercials: 'commercials-section'
  };
  const heading = document.querySelector('.admin-heading');
  if (heading && pageInfo[page]) {
    document.title = `${pageInfo[page][0]} - PennyBuys admin`;
    heading.querySelector('h1').textContent = pageInfo[page][0];
    heading.querySelector('p:not(.eyebrow)').textContent = pageInfo[page][1];
  }
  const visibleSection = sectionByPage[page] || sectionByPage.overview;
  document.querySelectorAll('#admin-dashboard .dashboard-section').forEach(section => {
    section.hidden = section.id !== visibleSection;
  });
  const hrefByPage = {
    overview: 'admin-overview.html', inventory: 'admin-inventory.html', orders: 'admin-order-management.html',
    reviews: 'admin-reviews.html', 'product-editor': 'admin-product-editor.html', subscribers: 'admin-subscribers.html',
    commercials: 'admin-commercials.html'
  };
  document.querySelectorAll('.admin-workflow a,.admin-mobile-nav a').forEach(link => {
    if (link.getAttribute('href') === hrefByPage[page]) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
})();
