(() => {
  const countries = {
    GB: { name: 'United Kingdom', currency: 'GBP', locale: 'en-GB' },
    NG: { name: 'Nigeria', currency: 'NGN', locale: 'en-NG' },
    BR: { name: 'Brazil', currency: 'BRL', locale: 'pt-BR' },
    QA: { name: 'Qatar', currency: 'QAR', locale: 'en-QA' },
    AU: { name: 'Australia', currency: 'AUD', locale: 'en-AU' },
    US: { name: 'United States', currency: 'USD', locale: 'en-US' },
    CA: { name: 'Canada', currency: 'CAD', locale: 'en-CA' }
  };
  const preferenceKey = 'pennybuys-currency-settings-v1';
  const locationConsentKey = 'pennybuys-site-consent-v1';
  const cookieNoticeKey = 'pennybuys-cookie-notice-v1';
  const rateKey = 'pennybuys-gbp-rates-v1';
  const whatsappNumber = '2348031421214';
  let settings = read(preferenceKey, { country: 'GB', mode: 'auto' });
  let rates = { GBP: 1 };
  let ratesReady = false;

  function read(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage can be disabled by the browser. */ }
  }
  function emitChange() {
    window.dispatchEvent(new CustomEvent('pennybuys:currencychange', { detail: { ...settings } }));
    updateCurrencyNote();
  }
  function format(gbpValue) {
    const country = countries[settings.country] || countries.GB;
    const rate = Number(rates[country.currency]);
    if (!Number.isFinite(rate)) return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(gbpValue || 0));
    try {
      return new Intl.NumberFormat(country.locale, { style: 'currency', currency: country.currency }).format(Number(gbpValue || 0) * rate);
    } catch {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(gbpValue || 0));
    }
  }
  function updateCurrencyNote() {
    const note = document.querySelector('[data-currency-note]');
    if (!note) return;
    const country = countries[settings.country] || countries.GB;
    note.textContent = country.currency === 'GBP'
      ? 'Prices and demo order totals are shown in GBP.'
      : ratesReady
        ? 'Indicative conversion from GBP; demo orders are recorded in GBP.'
        : 'Exchange rates are unavailable; prices are shown in GBP.';
  }
  window.PennyBuysCurrency = { format, get country() { return settings.country; } };

  function makeSelector() {
    const utilityLinks = document.querySelector('.utility-bar > div');
    const commerceHeader = document.querySelector('.commerce-header');
    const existing = document.querySelector('.currency-picker');
    if (existing) return;
    if (!utilityLinks && !commerceHeader) return;
    const label = document.createElement('label');
    label.className = 'currency-picker';
    label.innerHTML = '<span class="currency-picker-label">Ship to</span><select aria-label="Country and currency">' +
      Object.entries(countries).map(([code, item]) => `<option value="${code}">${item.name} · ${item.currency}</option>`).join('') + '</select><button type="button" class="location-trigger" aria-label="Detect my country" title="Detect my country"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg><span>Detect</span></button>';
    const select = label.querySelector('select');
    select.value = countries[settings.country] ? settings.country : 'GB';
    select.addEventListener('change', () => {
      settings = { country: select.value, mode: 'manual' };
      write(preferenceKey, settings);
      emitChange();
    });
    if (utilityLinks) {
      document.querySelectorAll('.utility-bar .deliver-to').forEach(item => item.remove());
      utilityLinks.append(label);
    } else {
      const toolbar = document.createElement('div');
      toolbar.className = 'currency-toolbar';
      toolbar.append(label);
      commerceHeader.insertAdjacentElement('afterend', toolbar);
    }
  }

  function makeAccountMenu(user) {
    const utilityGreeting = document.querySelector('.utility-bar > span');
    const commerceHeader = document.querySelector('.commerce-header');
    if (!user || (!utilityGreeting && !commerceHeader)) return;

    let profileDialog = document.querySelector('#account-profile-dialog');
    if (!profileDialog) {
      profileDialog = document.createElement('dialog');
      profileDialog.id = 'account-profile-dialog';
      profileDialog.className = 'account-profile-dialog';
      profileDialog.setAttribute('aria-labelledby', 'account-profile-title');
      profileDialog.innerHTML = '<button type="button" class="account-profile-close" aria-label="Close profile">&times;</button><span class="account-profile-avatar" aria-hidden="true"></span><p class="eyebrow">YOUR PENNYBUYS ACCOUNT</p><h2 id="account-profile-title">Your profile</h2><dl><div><dt>Name</dt><dd data-profile-name></dd></div><div><dt>Email</dt><dd data-profile-email></dd></div></dl><div class="account-profile-actions"><button type="button" class="account-signout">Sign out</button><button type="button" class="account-profile-done">Done</button></div>';
      document.body.append(profileDialog);
      profileDialog.querySelector('.account-profile-close').addEventListener('click', () => profileDialog.close());
      profileDialog.querySelector('.account-profile-done').addEventListener('click', () => profileDialog.close());
      profileDialog.addEventListener('click', event => { if (event.target === profileDialog) profileDialog.close(); });
    }
    profileDialog.querySelector('.account-profile-avatar').textContent = String(user.name || user.email).trim().charAt(0).toUpperCase();
    profileDialog.querySelector('[data-profile-name]').textContent = user.name || 'PennyBuys customer';
    profileDialog.querySelector('[data-profile-email]').textContent = user.email;

    const control = document.createElement('div');
    control.className = utilityGreeting ? 'account-control utility-account-control' : 'account-control commerce-account-control';
    control.innerHTML = '<button class="account-control-trigger" type="button" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg><span class="account-control-name"></span><svg class="account-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><div class="account-menu" role="menu" hidden><div class="account-menu-heading"><small>Signed in as</small><b class="account-menu-email"></b></div><button type="button" role="menuitem" data-account-profile>My profile</button><button type="button" role="menuitem" class="account-signout">Sign out</button></div>';
    const trigger = control.querySelector('.account-control-trigger');
    control.querySelector('.account-control-name').textContent = user.name || 'My account';
    control.querySelector('.account-menu-email').textContent = user.email;
    const menu = control.querySelector('.account-menu');
    const closeMenu = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
    trigger.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; trigger.setAttribute('aria-expanded', String(open)); });
    control.querySelector('[data-account-profile]').addEventListener('click', () => { closeMenu(); profileDialog.showModal(); });
    [...control.querySelectorAll('.account-signout'), profileDialog.querySelector('.account-signout')].forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const response = await fetch('/api/auth/signout', { method: 'POST', credentials: 'same-origin' });
        if (!response.ok) throw new Error('Sign out request failed');
        try { localStorage.removeItem('pennybuys-demo-session'); } catch { /* Storage can be disabled by the browser. */ }
        window.location.reload();
      } catch {
        button.disabled = false;
        window.alert('We could not sign you out just now. Please check your connection and try again.');
      }
    }));
    document.addEventListener('click', event => { if (!control.contains(event.target)) closeMenu(); });
    if (utilityGreeting) utilityGreeting.replaceChildren(control);
    else {
      const bag = commerceHeader.querySelector('.commerce-bag, .checkout-secure');
      commerceHeader.insertBefore(control, bag || null);
    }
  }

  async function loadCustomerAccount() {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (data.user?.email) makeAccountMenu(data.user);
    } catch { /* Visitors can still browse if the account service is unavailable. */ }
  }

  function makeCookieBanner() {
    if (document.querySelector('#cookie-notice')) return;
    const banner = document.createElement('aside');
    banner.id = 'cookie-notice';
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-labelledby', 'cookie-title');
    banner.innerHTML = `<span class="cookie-banner-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c-4.5 0-7-2.5-7-7a2 2 0 0 0-2-2Z"/><circle cx="8" cy="10" r="1"/><circle cx="11" cy="16" r="1"/><circle cx="15" cy="11" r="1"/></svg></span><div class="cookie-banner-copy"><b id="cookie-title">A little note about cookies</b><p>We use essential browser storage to keep your basket and checkout working. We do not use advertising or analytics cookies. <a href="privacy-policy.html">Privacy policy</a></p></div><button type="button" class="cookie-banner-accept">Okay, got it</button><button type="button" class="cookie-banner-close" aria-label="Dismiss cookie notice">×</button>`;
    document.body.append(banner);
    const hide = () => {
      write(cookieNoticeKey, { acknowledged: true, savedAt: new Date().toISOString() });
      banner.classList.remove('is-visible');
      window.setTimeout(() => { banner.hidden = true; }, 220);
    };
    banner.querySelector('.cookie-banner-accept').addEventListener('click', hide);
    banner.querySelector('.cookie-banner-close').addEventListener('click', hide);
    document.querySelectorAll('[data-open-cookie-settings]').forEach(button => button.addEventListener('click', () => {
      banner.hidden = false;
      requestAnimationFrame(() => banner.classList.add('is-visible'));
    }));
    if (!read(cookieNoticeKey, null)) requestAnimationFrame(() => banner.classList.add('is-visible'));
    else banner.hidden = true;
  }

  function makeLocationDialog() {
    if (document.querySelector('#location-preferences')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'location-preferences';
    dialog.className = 'location-dialog';
    dialog.setAttribute('aria-labelledby', 'location-title');
    dialog.innerHTML = `<button type="button" class="location-dialog-close" aria-label="Close location settings">×</button><span class="location-dialog-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg></span><p class="eyebrow">COUNTRY &amp; CURRENCY</p><h2 id="location-title">Use your approximate location?</h2><p class="location-dialog-copy">If you choose this, we’ll check your country from your IP address and suggest the matching currency. Your precise location is not saved. You can also choose a country manually from the selector.</p><p id="location-status" class="location-status"></p><div class="location-dialog-actions"><button type="button" class="location-dialog-cancel">Keep my current choice</button><button type="button" class="location-dialog-use">Use my location</button><button type="button" class="location-dialog-disable" hidden>Turn off automatic location</button></div>`;
    document.body.append(dialog);
    const useButton = dialog.querySelector('.location-dialog-use');
    const disableButton = dialog.querySelector('.location-dialog-disable');
    function openLocationDialog() {
      const consent = read(locationConsentKey, null);
      useButton.textContent = consent?.location ? 'Detect again' : 'Use my location';
      disableButton.hidden = !consent?.location;
      document.querySelector('#location-status').textContent = settings.mode === 'manual'
        ? `Your current selection is ${countries[settings.country]?.name || 'United Kingdom'}.`
        : consent?.location ? 'Automatic country suggestion is enabled.' : 'Location is off. Prices use UK pounds unless you choose another country above.';
      dialog.showModal();
    }
    useButton.addEventListener('click', () => {
      write(locationConsentKey, { location: true, savedAt: new Date().toISOString() });
      settings.mode = 'auto';
      write(preferenceKey, settings);
      dialog.close();
      suggestCountry();
    });
    disableButton.addEventListener('click', () => {
      write(locationConsentKey, { location: false, savedAt: new Date().toISOString() });
      dialog.close();
      if (settings.mode !== 'manual') setCountry('GB', 'auto');
    });
    dialog.querySelector('.location-dialog-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('.location-dialog-cancel').addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close(); });
    document.querySelector('.location-trigger')?.addEventListener('click', openLocationDialog);
    window.openPennyBuysLocation = openLocationDialog;
  }

  function setCountry(country, mode) {
    settings = { country: countries[country] ? country : 'GB', mode };
    write(preferenceKey, settings);
    const select = document.querySelector('.currency-picker select');
    if (select) select.value = settings.country;
    emitChange();
  }
  async function suggestCountry() {
    const saved = read('pennybuys-location-suggestion-v1', null);
    if (saved && Date.now() - saved.checkedAt < 24 * 60 * 60 * 1000) {
      if (settings.mode !== 'manual') setCountry(saved.country, 'auto');
      return;
    }
    try {
      const response = await fetch('https://ipapi.co/json/', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('Location lookup failed');
      const result = await response.json();
      const country = countries[result.country_code] ? result.country_code : 'GB';
      write('pennybuys-location-suggestion-v1', { country, checkedAt: Date.now() });
      if (settings.mode !== 'manual') setCountry(country, 'auto');
    } catch {
      if (settings.mode !== 'manual') setCountry('GB', 'auto');
    }
  }
  async function loadRates() {
    const cached = read(rateKey, null);
    if (cached && cached.rates && Date.now() - cached.fetchedAt < 36 * 60 * 60 * 1000) {
      rates = { ...rates, ...cached.rates };
      ratesReady = true;
      emitChange();
      return;
    }
    try {
      const response = await fetch('https://api.frankfurter.dev/v2/rates?base=GBP&quotes=NGN,QAR,USD,CAD,AUD,BRL');
      if (!response.ok) throw new Error('Rates unavailable');
      const rows = await response.json();
      const next = { GBP: 1 };
      rows.forEach(row => { if (Number.isFinite(Number(row.rate))) next[row.quote] = Number(row.rate); });
      rates = { ...rates, ...next };
      ratesReady = true;
      write(rateKey, { rates: next, fetchedAt: Date.now(), date: rows[0]?.date || '' });
      emitChange();
    } catch {
      if (cached?.rates) { rates = { ...rates, ...cached.rates }; ratesReady = true; }
      emitChange();
    }
  }
  function makeWhatsApp() {
    if (document.querySelector('.whatsapp-float')) return;
    const link = document.createElement('a');
    link.className = 'whatsapp-float';
    link.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent('Hi PennyBuys, I need some help.')}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', 'Chat with PennyBuys on WhatsApp');
    link.innerHTML = '<span class="whatsapp-tooltip">Chat with us</span><svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16.02 3.2A12.72 12.72 0 0 0 5.1 22.44L3.4 28.7l6.42-1.68A12.72 12.72 0 1 0 16.02 3.2Zm0 23.12c-2 0-3.96-.54-5.66-1.58l-.4-.24-3.81 1 1.02-3.72-.26-.42a10.35 10.35 0 1 1 9.11 4.96Zm5.68-7.75c-.31-.16-1.83-.9-2.12-1-.28-.1-.49-.16-.7.16-.21.31-.8 1-1 1.2-.19.21-.37.24-.68.08-.32-.16-1.34-.49-2.55-1.57-.94-.84-1.57-1.88-1.76-2.19-.18-.32-.02-.49.14-.65.14-.14.32-.37.48-.55.16-.19.21-.32.32-.53.1-.21.05-.4-.03-.56-.08-.16-.7-1.69-.96-2.31-.26-.6-.51-.52-.7-.53h-.6c-.21 0-.55.08-.84.4-.29.31-1.1 1.07-1.1 2.6s1.13 3.02 1.28 3.23c.16.21 2.21 3.38 5.36 4.74.75.33 1.33.53 1.78.68.75.24 1.43.21 1.97.13.6-.09 1.83-.75 2.09-1.48.26-.74.26-1.37.18-1.5-.08-.13-.29-.21-.6-.37Z"/></svg>';
    document.body.append(link);
  }
  function makeCookieSettingsLink() {
    const footer = document.querySelector('footer');
    if (!footer || footer.querySelector('[data-open-cookie-settings]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cookie-settings-link';
    button.dataset.openCookieSettings = '';
    button.textContent = 'Cookie settings';
    (footer.querySelector('.footer-bottom') || footer.querySelector('.commerce-footer') || footer).append(button);
  }

  makeSelector();
  loadCustomerAccount();
  makeWhatsApp();
  makeCookieSettingsLink();
  makeLocationDialog();
  makeCookieBanner();
  updateCurrencyNote();
  const consent = read(locationConsentKey, null);
  if (consent?.location && settings.mode !== 'manual') suggestCountry();
  else if (settings.mode !== 'manual') setCountry('GB', 'auto');
  if (!countries[settings.country]) setCountry('GB', 'auto');
  emitChange();
  loadRates();
})();
