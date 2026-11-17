(() => {
  const decodeKey = value => {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  };
  window.PennyBuysPush = {
    async subscribe({ email = '', adminToken = '', conversationId = '' } = {}) {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('This browser does not support push notifications.');
      const configResponse = await fetch('/api/notifications/config', { cache: 'no-store' });
      const config = await configResponse.json();
      if (!config.enabled || !config.publicKey) throw new Error('Push notifications are not configured yet. Please contact PennyBuys support.');
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to receive updates.');
      const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeKey(config.publicKey) });
      const admin = Boolean(adminToken);
      const response = await fetch(admin ? '/api/admin/notifications/subscribe' : '/api/notifications/subscribe', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(admin ? { 'x-admin-token': adminToken } : {}) },
        body: JSON.stringify({ subscription: subscription.toJSON(), email, conversationId })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not save your notification settings.');
      return result;
    }
  };
})();
