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
  const consentKey = 'pennybuys-site-consent-v1';
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
    const mount = document.querySelector('.header-actions') || document.querySelector('.commerce-header');
    if (!mount || mount.querySelector('.currency-picker')) return;
    const label = document.createElement('label');
    label.className = 'currency-picker';
    label.innerHTML = '<span class="currency-picker-label">Ship to</span><select aria-label="Country and currency">' +
      Object.entries(countries).map(([code, item]) => `<option value="${code}">${item.name} · ${item.currency}</option>`).join('') + '</select>';
    const select = label.querySelector('select');
    select.value = countries[settings.country] ? settings.country : 'GB';
    select.addEventListener('change', () => {
      settings = { country: select.value, mode: 'manual' };
      write(preferenceKey, settings);
      emitChange();
    });
    if (mount.classList.contains('commerce-header')) {
      const bag = mount.querySelector('.commerce-bag, .checkout-bag, .commerce-header > a:last-of-type');
      if (bag) mount.insertBefore(label, bag); else mount.append(label);
    } else mount.prepend(label);
  }

  function makeCookieDialog() {
    if (document.querySelector('#cookie-preferences')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'cookie-preferences';
    dialog.className = 'cookie-dialog';
    dialog.setAttribute('aria-labelledby', 'cookie-title');
    dialog.innerHTML = `<div class="cookie-dialog-mark" aria-hidden="true">✳</div>
      <p class="eyebrow">YOUR PRIVACY, YOUR CALL</p><h2 id="cookie-title">Cookie &amp; privacy choices</h2>
      <p class="cookie-intro">Essential browser storage keeps your basket and checkout working. We do not use advertising or analytics cookies.</p>
      <label class="location-choice"><input type="checkbox" id="location-choice"><span><b>Suggest my country and currency</b><small>If enabled, we’ll use your approximate IP location to suggest one of the countries below. Your location is not stored as a precise address.</small></span></label>
      <p class="cookie-location-note">You can also choose your country at any time from the page header. If location is off, prices default to UK pounds.</p>
      <div class="cookie-actions"><button type="button" class="cookie-essential">Essential only</button><button type="button" class="cookie-save">Save choices</button></div>
      <button type="button" class="cookie-allow">Allow location suggestion</button>
      <button type="button" class="cookie-close" aria-label="Close privacy choices">×</button>`;
    document.body.append(dialog);
    const checkbox = dialog.querySelector('#location-choice');
    function closeWith(locationEnabled) {
      write(consentKey, { location: locationEnabled, savedAt: new Date().toISOString() });
      dialog.close();
      if (locationEnabled) suggestCountry();
      else if (settings.mode !== 'manual') setCountry('GB', 'auto');
    }
    dialog.querySelector('.cookie-essential').addEventListener('click', () => closeWith(false));
    dialog.querySelector('.cookie-save').addEventListener('click', () => closeWith(checkbox.checked));
    dialog.querySelector('.cookie-allow').addEventListener('click', () => { checkbox.checked = true; closeWith(true); });
    dialog.querySelector('.cookie-close').addEventListener('click', () => {
      if (!read(consentKey, null)) closeWith(false); else dialog.close();
    });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      if (!read(consentKey, null)) closeWith(false); else dialog.close();
    });
    document.querySelectorAll('[data-open-cookie-settings]').forEach(button => button.addEventListener('click', () => {
      const saved = read(consentKey, { location: false });
      checkbox.checked = Boolean(saved.location);
      dialog.showModal();
    }));
    if (!read(consentKey, null)) dialog.showModal();
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
  makeWhatsApp();
  makeCookieSettingsLink();
  makeCookieDialog();
  updateCurrencyNote();
  const consent = read(consentKey, null);
  if (consent?.location && settings.mode !== 'manual') suggestCountry();
  if (!countries[settings.country]) setCountry('GB', 'auto');
  emitChange();
  loadRates();
})();
