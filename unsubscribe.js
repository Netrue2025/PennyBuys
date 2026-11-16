const form=document.querySelector('#unsubscribe-form');
const message=document.querySelector('#unsubscribe-message');
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const button=form.querySelector('button[type=submit]');
  button.disabled=true;
  message.textContent='Updating your subscription...';
  try{
    const response=await fetch('/api/newsletter/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.elements.email.value})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'We could not update your subscription. Please try again.');
    form.hidden=true;
    message.classList.add('is-success');
    message.textContent='You’re unsubscribed. If this email was on our list, it has now been removed.';
  }catch(error){message.classList.add('is-error');message.textContent=error.message;}
  finally{button.disabled=false;}
});
