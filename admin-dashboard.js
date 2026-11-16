(() => {
  const ordersKey = 'pennybuys-orders';
  const subscriberCount = document.querySelector('#subscriber-count');
  const form = document.querySelector('#product-form');
  const steps = [...document.querySelectorAll('[data-form-step]')];
  const stepButtons = [...document.querySelectorAll('[data-step-go]')];
  let currentStep = 0;
  let highestStep = 0;
  let products = [];
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

  function readOrders() {
    try { return JSON.parse(localStorage.getItem(ordersKey) || '[]'); } catch { return []; }
  }
  function renderCategoryChart() {
    const chart = document.querySelector('#category-chart');
    const counts = new Map();
    products.forEach(product => counts.set(product.category || 'Other', (counts.get(product.category || 'Other') || 0) + 1));
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maximum = Math.max(1, ...entries.map(([, count]) => count));
    chart.innerHTML = entries.length ? entries.map(([name, count]) => `<div class="category-chart-row"><span class="category-chart-label" title="${escapeHTML(name)}">${escapeHTML(name)}</span><div class="category-chart-track"><div class="category-chart-bar" style="width:${Math.max(4, count / maximum * 100)}%"></div></div><b class="category-chart-count">${count}</b></div>`).join('') : '<div class="category-chart-empty">Your product categories will appear here.</div>';
  }
  function renderStock() {
    const quantities = products.map(product => Math.max(0, Number(product.inventory) || 0));
    const total = quantities.length;
    const zero = quantities.filter(quantity => quantity === 0).length;
    const low = quantities.filter(quantity => quantity > 0 && quantity <= 5).length;
    const healthy = total - zero - low;
    const percent = total ? Math.round(healthy / total * 100) : 0;
    const lowStart = healthy / Math.max(1, total) * 100;
    const emptyStart = (healthy + low) / Math.max(1, total) * 100;
    document.querySelector('#stock-ring').style.background = total
      ? `conic-gradient(#36a375 0 ${lowStart}%,#f2b34b ${lowStart}% ${emptyStart}%,#e1e6ef ${emptyStart}% 100%)`
      : 'conic-gradient(#e1e6ef 0 100%)';
    document.querySelector('#stock-healthy-percent').textContent = `${percent}%`;
    document.querySelector('#stock-healthy-count').textContent = healthy;
    document.querySelector('#stock-low-count').textContent = low;
    document.querySelector('#stock-empty-count').textContent = zero;
    document.querySelector('#overview-stock').textContent = quantities.reduce((sum, quantity) => sum + quantity, 0).toLocaleString('en-GB');
  }
  function renderOrderChart(orders) {
    const definitions = [
      ['processing', 'Processing', '#6685ea'],
      ['packed', 'Packed', '#a87ce6'],
      ['in_transit', 'On the way', '#e89a4d'],
      ['delivered', 'Delivered', '#36a375']
    ];
    const chart = document.querySelector('#order-chart');
    const max = Math.max(1, ...definitions.map(([key]) => orders.filter(order => (order.status || 'processing') === key).length));
    chart.innerHTML = orders.length ? definitions.map(([key, label, color]) => {
      const count = orders.filter(order => (order.status || 'processing') === key).length;
      return `<div class="order-chart-row"><span class="order-chart-label">${label}</span><div class="order-chart-track"><div class="order-chart-bar" style="width:${Math.max(count ? 7 : 0, count / max * 100)}%;background:${color}"></div></div><b class="order-chart-count">${count}</b></div>`;
    }).join('') : '<div class="order-chart-empty">Order stages will appear when demo orders are placed.</div>';
    const open = orders.filter(order => order.status !== 'delivered').length;
    document.querySelector('#overview-orders').textContent = open;
    document.querySelector('#order-count').textContent = orders.length;
    document.querySelector('#nav-order-count').textContent = orders.length;
  }
  function renderOverview() {
    document.querySelector('#overview-products').textContent = products.length;
    renderCategoryChart();
    renderStock();
    renderOrderChart(readOrders());
    const count = Number(subscriberCount.textContent) || 0;
    document.querySelector('#overview-subscribers').textContent = count;
  }
  function goToStep(index) {
    const next = Math.min(Math.max(Number(index) || 0, 0), 2);
    if (next > highestStep) return;
    currentStep = next;
    steps.forEach((step, stepIndex) => { step.hidden = stepIndex !== currentStep; });
    stepButtons.forEach((button, stepIndex) => {
      button.toggleAttribute('aria-current', stepIndex === currentStep);
      if (stepIndex === currentStep) button.setAttribute('aria-current', 'step');
      button.classList.toggle('is-complete', stepIndex < currentStep);
    });
    document.querySelector('#form-progress-fill').style.width = `${currentStep * 50}%`;
  }
  function validateStep(index) {
    const step = steps[index];
    for (const field of step.querySelectorAll('[required]')) {
      if (!field.checkValidity()) { field.reportValidity(); field.focus(); return false; }
    }
    return true;
  }
  window.PennyBuysAdminWizard = { goToStep };
  document.querySelectorAll('[data-step-go]').forEach(button => button.addEventListener('click', () => goToStep(Number(button.dataset.stepGo))));
  document.querySelectorAll('[data-step-next]').forEach(button => button.addEventListener('click', () => {
    if (!validateStep(currentStep)) return;
    highestStep = Math.max(highestStep, currentStep + 1);
    goToStep(currentStep + 1);
    document.querySelector('#product-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.querySelectorAll('[data-step-back]').forEach(button => button.addEventListener('click', () => goToStep(currentStep - 1)));
  form.addEventListener('submit', event => {
    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const invalid = [...steps[stepIndex].querySelectorAll('[required]')].find(field => !field.checkValidity());
      if (!invalid) continue;
      event.preventDefault();
      highestStep = Math.max(highestStep, stepIndex);
      goToStep(stepIndex);
      invalid.reportValidity();
      invalid.focus();
      return;
    }
  }, true);
  window.addEventListener('pennybuys:productedit', () => { highestStep = 2; goToStep(0); });
  window.addEventListener('pennybuys:productcancel', () => { highestStep = 0; goToStep(0); });
  window.addEventListener('pennybuys:startnewproduct', () => { highestStep = 0; goToStep(0); });

  const search = document.querySelector('#product-search');
  const clearSearch = document.querySelector('#clear-product-search');
  search.addEventListener('input', () => {
    clearSearch.hidden = !search.value;
    window.dispatchEvent(new CustomEvent('pennybuys:adminproductsearch', { detail: search.value }));
  });
  clearSearch.addEventListener('click', () => { search.value = ''; clearSearch.hidden = true; search.focus(); window.dispatchEvent(new CustomEvent('pennybuys:adminproductsearch', { detail: '' })); });
  window.addEventListener('pennybuys:adminproductschange', event => { products = event.detail.products || []; renderOverview(); });
  window.addEventListener('pennybuys:adminsubscriberschange', renderOverview);
  window.addEventListener('pennybuys:admin-orders-change', renderOverview);
  window.addEventListener('storage', event => { if (event.key === ordersKey) renderOverview(); });
  window.addEventListener('pennybuys:adminready', renderOverview);

  const dashboard = document.querySelector('#admin-dashboard');
  const sidebar = document.querySelector('#admin-sidebar');
  const toggle = document.querySelector('#admin-menu-toggle');
  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'admin-menu-backdrop';
  backdrop.setAttribute('aria-label', 'Close admin menu');
  dashboard.append(backdrop);
  function closeSidebar() { sidebar.classList.remove('is-open'); backdrop.classList.remove('is-visible'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-label', 'Open admin menu'); }
  toggle.addEventListener('click', () => {
    const open = !sidebar.classList.contains('is-open');
    sidebar.classList.toggle('is-open', open); backdrop.classList.toggle('is-visible', open);
    toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? 'Close admin menu' : 'Open admin menu');
  });
  backdrop.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSidebar(); });
  document.querySelectorAll('.admin-workflow a,.admin-mobile-nav a').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.admin-workflow a,.admin-mobile-nav a').forEach(item => item.removeAttribute('aria-current'));
    document.querySelectorAll(`a[href="${link.getAttribute('href')}"]`).forEach(item => item.setAttribute('aria-current', 'location'));
    closeSidebar();
    if (link.getAttribute('href') === '#product-editor') window.dispatchEvent(new Event('pennybuys:startnewproduct'));
  }));
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const href = `#${entry.target.id}`;
      document.querySelectorAll('.admin-workflow a,.admin-mobile-nav a').forEach(link => {
        if (link.getAttribute('href') === href) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
      });
    }), { rootMargin: '-15% 0px -72% 0px' });
    document.querySelectorAll('.dashboard-section').forEach(section => observer.observe(section));
  }
  window.addEventListener('hashchange', () => {
    const target = location.hash;
    document.querySelectorAll('.admin-workflow a,.admin-mobile-nav a').forEach(link => link.toggleAttribute('aria-current', link.getAttribute('href') === target));
    if (target === '#product-editor') window.dispatchEvent(new Event('pennybuys:startnewproduct'));
  });
  renderOverview();
})();
