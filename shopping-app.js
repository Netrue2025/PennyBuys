(() => {
  const products = Array.isArray(window.STORE_PRODUCTS) ? window.STORE_PRODUCTS : [];
  const bagKey = 'pennybuys-bag';
  const grid = document.querySelector('#app-product-grid');
  const search = document.querySelector('#app-search-input');
  const categoryList = document.querySelector('#app-category-list');
  const note = document.querySelector('#app-results-note');
  const empty = document.querySelector('#app-empty-state');
  let selectedCategory = 'All';
  let query = '';
  let toastTimer;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const money = value => window.PennyBuysCurrency?.format(Number(value) || 0) || `£${(Number(value) || 0).toFixed(2)}`;
  const groupNames = { Bags: 'Bags & accessories', Travel: 'Travel essentials', Home: 'Home & little joys' };
  const categories = ['All', ...new Set(products.map(product => product.group).filter(Boolean))];

  function readBag() {
    try { const bag = JSON.parse(localStorage.getItem(bagKey) || '[]'); return Array.isArray(bag) ? bag : []; }
    catch { return []; }
  }
  function updateBagCount() {
    const count = readBag().reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    document.querySelectorAll('.app-bag-count,.app-bottom-count').forEach(node => { node.textContent = count; node.hidden = count < 1; });
  }
  function renderCategories() {
    categoryList.innerHTML = categories.map(group => `<button class="app-category-chip ${selectedCategory === group ? 'is-active' : ''}" type="button" data-app-category="${escapeHTML(group)}" aria-pressed="${selectedCategory === group}">${escapeHTML(groupNames[group] || (group === 'All' ? 'Everything' : group))}</button>`).join('');
  }
  function filteredProducts() {
    const term = query.toLocaleLowerCase('en-GB').trim();
    return products.filter(product => {
      const categoryMatches = selectedCategory === 'All' || product.group === selectedCategory;
      const text = `${product.name} ${product.category} ${product.group} ${product.badge}`.toLocaleLowerCase('en-GB');
      return categoryMatches && (!term || text.includes(term));
    });
  }
  function renderProducts() {
    const found = filteredProducts();
    note.textContent = query ? `${found.length} finds for “${query}”` : `${found.length} thoughtful finds, chosen with care.`;
    empty.hidden = found.length > 0;
    grid.hidden = found.length === 0;
    grid.innerHTML = found.map(product => `<article class="app-product-card">
      <a class="app-product-image" href="product.html?id=${encodeURIComponent(product.id)}" aria-label="View ${escapeHTML(product.name)}"><img src="${escapeHTML(product.image)}" alt="${escapeHTML(product.alt || product.name)}" loading="lazy">${product.badge ? `<span class="app-product-badge">${escapeHTML(product.badge)}</span>` : ''}</a>
      <div class="app-product-info"><div class="app-product-category">${escapeHTML(product.category || '')}</div><h3 class="app-product-name"><a href="product.html?id=${encodeURIComponent(product.id)}">${escapeHTML(product.name)}</a></h3><div class="app-product-rating" aria-label="Rated ${escapeHTML(product.rating || '5.0')} out of 5">★ ${escapeHTML(product.rating || '5.0')} <span>(${Number(product.reviews) || 0})</span></div><div class="app-product-bottom"><strong class="app-product-price">${money(product.price)}</strong><button class="app-quick-add" type="button" data-app-add="${escapeHTML(product.id)}" aria-label="Add ${escapeHTML(product.name)} to basket">+</button></div></div>
    </article>`).join('');
    if (window.PennyBuysImages?.refresh) window.PennyBuysImages.refresh(grid);
  }
  function addToBag(id, button) {
    const bag = readBag();
    const line = bag.find(item => item.id === id);
    if (line) line.qty = Math.min(99, (Number(line.qty) || 0) + 1);
    else bag.push({ id, qty: 1 });
    localStorage.setItem(bagKey, JSON.stringify(bag));
    updateBagCount();
    const product = products.find(item => item.id === id);
    const toast = document.querySelector('.app-toast');
    toast.textContent = `${product?.name || 'Your find'} added to your basket`;
    toast.classList.add('is-visible');
    button.classList.add('is-added');
    button.textContent = 'Added';
    window.setTimeout(() => { button.classList.remove('is-added'); button.textContent = '+'; }, 1100);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2200);
  }
  document.querySelector('#app-search-form').addEventListener('submit', event => {
    event.preventDefault();
    query = search.value.trim();
    selectedCategory = 'All';
    renderCategories();
    renderProducts();
    document.querySelector('#app-products-heading').textContent = query ? 'Search results' : 'Little things. Big love.';
    document.querySelector('#app-products-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  categoryList.addEventListener('click', event => {
    const button = event.target.closest('[data-app-category]');
    if (!button) return;
    selectedCategory = button.dataset.appCategory;
    query = '';
    search.value = '';
    document.querySelector('#app-products-heading').textContent = selectedCategory === 'All' ? 'Little things. Big love.' : groupNames[selectedCategory] || selectedCategory;
    renderCategories();
    renderProducts();
  });
  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-app-add]');
    if (button) addToBag(button.dataset.appAdd, button);
  });
  window.addEventListener('storage', event => { if (event.key === bagKey) updateBagCount(); });
  renderCategories();
  renderProducts();
  updateBagCount();
})();
