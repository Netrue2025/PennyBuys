document.querySelector('#site-home-newsletter')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector('.site-home-newsletter-status');
  const button = form.querySelector('button[type=submit]');
  button.disabled = true;
  status.textContent = 'Saving your subscription…';
  try {
    const response = await fetch('/api/newsletter/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.elements.email.value, consent: form.elements.consent.checked }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not save your subscription. Please try again.');
    status.textContent = data.alreadySubscribed ? 'You are already subscribed.' : 'You are subscribed to PennyBuys updates.';
    form.reset();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
