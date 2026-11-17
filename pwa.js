(() => {
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} }
  };
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  let installPrompt = null;
  let installBar;
  let installButton;
  let installLink;
  let pushTimer;

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
      storage.set('pennybuys-install-dismissed-until', String(Date.now() + 30 * 24 * 60 * 60 * 1000));
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
      const dismissedUntil = Number(storage.get('pennybuys-install-dismissed-until') || 0);
      if (!standalone() && storage.get('pennybuys-app-installed') !== 'yes' && dismissedUntil < Date.now()) installBar.classList.add('is-visible');
    }, 8500);
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

  createInstallBar();
  schedulePushPrompt();
  window.addEventListener('pagehide', () => window.clearTimeout(pushTimer), { once: true });
})();
