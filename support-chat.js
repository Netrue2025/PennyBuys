(() => {
  const storageKey = 'pennybuys-support-chat-v1';
  const messages = document.querySelector('#support-chat-messages');
  const form = document.querySelector('#support-chat-form');
  if (!messages || !form) return;
  const status = document.querySelector('#support-chat-status');
  const messageInput = form.elements.message;
  const send = form.querySelector('[type="submit"]');
  const loadIdentity = () => {
    try { return JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { return {}; }
  };
  const identity = loadIdentity();
  identity.id ||= crypto.randomUUID();
  form.elements.name.value = identity.name || '';
  form.elements.email.value = identity.email || '';
  let lastMessageCount = -1;
  let busy = false;
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const renderMessages = rows => {
    if (rows.length === lastMessageCount) return;
    lastMessageCount = rows.length;
    messages.innerHTML = rows.length ? rows.map(item => `<article class="support-chat-message ${item.sender === 'customer' ? 'from-customer' : 'from-admin'}"><b>${escapeHTML(item.sender === 'customer' ? 'You' : 'PennyBuys support')}</b><p>${escapeHTML(item.message)}</p><time>${new Date(item.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time></article>`).join('') : '<p class="support-chat-empty">Send us a message and we’ll reply here.</p>';
    messages.scrollTop = messages.scrollHeight;
  };
  async function refresh() {
    if (busy || document.hidden) return;
    try {
      const response = await fetch(`/api/support/conversations/${encodeURIComponent(identity.id)}/messages`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Chat is unavailable.');
      status.textContent = 'We’ll reply here as soon as we can';
      renderMessages(data.messages || []);
    } catch (error) { status.textContent = error.message; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const message = messageInput.value.trim();
    if (!message || busy) return;
    identity.name = form.elements.name.value.trim();
    identity.email = form.elements.email.value.trim();
    if (!identity.name) { form.elements.name.reportValidity(); return; }
    localStorage.setItem(storageKey, JSON.stringify(identity));
    busy = true; send.disabled = true; status.textContent = 'Sending…';
    try {
      const response = await fetch(`/api/support/conversations/${encodeURIComponent(identity.id)}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: identity.name, email: identity.email, message }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Your message could not be sent.');
      messageInput.value = '';
      lastMessageCount = -1;
      await refresh();
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; send.disabled = false; messageInput.focus(); }
  });
  document.querySelector('#support-chat-notifications').addEventListener('click', async event => {
    const button = event.currentTarget;
    if (!form.elements.email.value.trim()) { form.elements.email.reportValidity(); return; }
    button.disabled = true; status.textContent = 'Enabling message notifications…';
    try {
      await window.PennyBuysPush.subscribe({ email: form.elements.email.value.trim(), conversationId: identity.id });
      button.textContent = 'Notifications enabled'; status.textContent = 'We’ll notify you when PennyBuys replies.';
    } catch (error) { status.textContent = error.message; button.disabled = false; }
  });
  refresh();
  window.setInterval(refresh, 4000);
})();
