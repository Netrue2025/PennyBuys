(() => {
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} }
  };
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const appContextKey = 'pennybuys-app-context';
  const pageName = location.pathname.split('/').pop() || 'index.html';
  if (pageName === 'app.html' || standalone()) {
    try { sessionStorage.setItem(appContextKey, 'yes'); } catch {}
  }
  let appContext = standalone() || pageName === 'app.html';
  try { appContext = appContext || sessionStorage.getItem(appContextKey) === 'yes'; } catch {}
  let installPrompt = null;
  let installBar;
  let installButton;
  let installLink;
  let pushTimer;

  function prepareFooterInstallLinks() {
    document.querySelectorAll('footer .footer-app-link').forEach(link => {
      link.classList.add('pwa-download-icon');
      link.setAttribute('aria-label', 'Download the PennyBuys app');
      link.title = 'Download the PennyBuys app';
      link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 16v4h14v-4"/></svg><span class="pwa-visually-hidden">Download the PennyBuys app</span>';
      link.addEventListener('click', async event => {
        if (standalone() || storage.get('pennybuys-app-installed') === 'yes' || !installPrompt) return;
        event.preventDefault();
        installPrompt.prompt();
        const choice = await installPrompt.userChoice;
        installPrompt = null;
        if (choice?.outcome === 'accepted') hideInstallBar();
      });
    });
  }

  function createAppNavigation() {
    if (!appContext || document.querySelector('.app-bottom-nav')) return;
    document.body.classList.add('pennybuys-app-context');
    const destinations = [
      { label: 'Home', href: '/app.html', pages: ['app.html'], icon: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>' },
      { label: 'Explore', href: '/catalog.html', pages: ['catalog.html', 'product.html'], icon: '<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="19" r="2"/>' },
      { label: 'Basket', href: '/basket.html', pages: ['basket.html', 'checkout.html'], icon: '<path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>' },
      { label: 'Orders', href: '/order.html', pages: ['order.html'], icon: '<path d="M4 7h16v13H4zM8 4v6m8-6v6M8 14h8"/>' },
      { label: 'Account', href: '/signin.html', pages: ['signin.html', 'signup.html'], icon: '<circle cx="12" cy="8" r="3.5"/><path d="M4.5 21c.5-4.5 3.2-6.8 7.5-6.8s7 2.3 7.5 6.8"/>' }
    ];
    const nav = document.createElement('nav');
    nav.className = 'app-bottom-nav';
    nav.setAttribute('aria-label', 'App navigation');
    nav.innerHTML = destinations.map(item => {
      const active = item.pages.includes(pageName);
      return `<a href="${item.href}"${active ? ' class="is-current" aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg><span>${item.label}</span>${item.label === 'Basket' ? '<i class="app-bottom-count" hidden>0</i>' : ''}</a>`;
    }).join('');
    document.body.append(nav);
    const updateCount = () => {
      let count = 0;
      try { const bag = JSON.parse(localStorage.getItem('pennybuys-bag') || '[]'); if (Array.isArray(bag)) count = bag.reduce((sum, item) => sum + (Number(item.qty) || 0), 0); } catch {}
      const badge = nav.querySelector('.app-bottom-count');
      badge.textContent = String(count);
      badge.hidden = count < 1;
    };
    updateCount();
    window.addEventListener('storage', event => { if (event.key === 'pennybuys-bag') updateCount(); });
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(error => console.warn('PennyBuys offline support is unavailable:', error.message));

  function createInstallBar() {
    if (document.querySelector('#pennybuys-install-bar') || standalone()) return;
    installBar = document.createElement('aside');
    installBar.id = 'pennybuys-install-bar';
    installBar.className = 'pwa-install-bar';
    installBar.setAttribute('aria-label', 'Get the PennyBuys shopping app');
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const installHint = ios ? 'Open the app, then tap Share, then Add to Home Screen.' : 'Tap Open app, then use your browser menu to install it.';
    installBar.innerHTML = `<img src="/Media/pennybuys-app-icon.svg" alt="" class="pwa-install-icon"><div class="pwa-install-copy"><b>Good things, one tap away</b><span>${installHint}</span></div><button class="pwa-install-action" type="button" hidden>Install</button><a class="pwa-install-action pwa-open-app" href="/app.html">Open app</a><button class="pwa-install-close" type="button" aria-label="Dismiss app download notice">&times;</button>`;
    document.body.append(installBar);
    installButton = installBar.querySelector('.pwa-install-action[hidden]');
    installLink = installBar.querySelector('.pwa-open-app');
    installBar.querySelector('.pwa-install-close').addEventListener('click', () => {
      try { sessionStorage.setItem('pennybuys-install-notice-shown', 'yes'); } catch {}
      hideInstallBar();
    });
    installButton.addEventListener('click', async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      hideInstallBar();
    });
    window.setTimeout(() => {
      let shownThisVisit = false;
      try { shownThisVisit = sessionStorage.getItem('pennybuys-install-notice-shown') === 'yes'; } catch {}
      if (!standalone() && storage.get('pennybuys-app-installed') !== 'yes' && !shownThisVisit) {
        try { sessionStorage.setItem('pennybuys-install-notice-shown', 'yes'); } catch {}
        installBar.classList.add('is-visible');
      }
    }, 3500);
  }
  function hideInstallBar() { installBar?.classList.remove('is-visible'); }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    if (installButton) { installButton.hidden = false; installLink.hidden = true; installBar.querySelector('.pwa-install-copy span').textContent = 'Add PennyBuys to your device for a quicker way to shop.'; }
  });
  window.addEventListener('appinstalled', () => {
    storage.set('pennybuys-app-installed', 'yes');
    hideInstallBar();
  });

  async function showPushPrompt() {
    if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator) || Notification.permission !== 'default') return;
    const lastShown = Number(storage.get('pennybuys-push-prompt-last-shown') || 0);
    if (Date.now() - lastShown < 30 * 24 * 60 * 60 * 1000) return;
    try {
      const response = await fetch('/api/notifications/config', { cache: 'no-store' });
      const config = await response.json();
      if (!config.enabled || !config.publicKey) return;
    } catch { return; }
    if (document.querySelector('#pennybuys-push-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'pennybuys-push-dialog';
    dialog.className = 'pwa-push-dialog';
    dialog.setAttribute('aria-labelledby', 'pwa-push-title');
    dialog.innerHTML = `<button class="pwa-push-close" type="button" aria-label="Close notification offer">×</button><span class="pwa-push-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></span><p class="pwa-push-eyebrow">A LITTLE NOTE FROM US</p><h2 id="pwa-push-title">Lovely finds, right on time.</h2><p class="pwa-push-description">Get a gentle heads-up when new things arrive, your order moves, or our team replies. You’re always in control.</p><p class="pwa-push-status" role="status" aria-live="polite"></p><button class="pwa-push-enable" type="button">Enable notifications</button><button class="pwa-push-later" type="button">Maybe later</button>`;
    document.body.append(dialog);
    const close = () => {
      storage.set('pennybuys-push-prompt-last-shown', String(Date.now()));
      dialog.close();
      dialog.remove();
    };
    dialog.querySelector('.pwa-push-close').addEventListener('click', close);
    dialog.querySelector('.pwa-push-later').addEventListener('click', close);
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.querySelector('.pwa-push-enable').addEventListener('click', async event => {
      const button = event.currentTarget;
      const status = dialog.querySelector('.pwa-push-status');
      button.disabled = true;
      status.textContent = 'Setting up your alerts…';
      try {
        await window.PennyBuysPush.subscribe();
        storage.set('pennybuys-push-enabled', 'yes');
        status.textContent = 'You’re all set. We’ll keep it useful.';
        window.setTimeout(close, 850);
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
        if (Notification.permission === 'denied') window.setTimeout(close, 2400);
      }
    });
    dialog.showModal();
  }

  function schedulePushPrompt() {
    if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator) || Notification.permission !== 'default') return;
    let startedAt = 0;
    try { startedAt = Number(sessionStorage.getItem('pennybuys-browse-started-at') || 0); } catch {}
    if (!startedAt) { startedAt = Date.now(); try { sessionStorage.setItem('pennybuys-browse-started-at', String(startedAt)); } catch {} }
    const remaining = Math.max(0, 40000 - (Date.now() - startedAt));
    pushTimer = window.setTimeout(showPushPrompt, remaining);
  }

  prepareFooterInstallLinks();
  createAppNavigation();
  createInstallBar();
  schedulePushPrompt();
  window.addEventListener('pagehide', () => window.clearTimeout(pushTimer), { once: true });
})();
