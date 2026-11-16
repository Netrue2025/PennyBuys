const sessionKey='pennybuys-demo-session';
const message=document.querySelector('#auth-message');
function setMessage(text,isError=false){message.textContent=text;message.classList.toggle('is-error',isError)}
function setSession(user){localStorage.setItem(sessionKey,JSON.stringify({email:user.email,name:user.name,signedInAt:new Date().toISOString()}))}
function continueAfterAuth(){const requested=new URLSearchParams(location.search).get('return');if(requested){const destination=new URL(requested,location.href);if(destination.origin===location.origin&&destination.pathname.endsWith('.html')){location.href=destination.href;return}}location.href='index.html'}
async function submitAuth(path,body){const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Sign-in is unavailable right now. Please try again.');setSession(data.user);continueAfterAuth()}

document.querySelectorAll('.password-toggle').forEach(button=>button.addEventListener('click',()=>{
  const input=button.parentElement.querySelector('input');const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'Hide':'Show';button.setAttribute('aria-label',show?'Hide password':'Show password');
}));

document.querySelectorAll('[data-google-auth]').forEach(button=>button.addEventListener('click',()=>setMessage('Google sign-in is not connected yet. Connect Google OAuth to enable this option.',true)));

document.querySelector('#password-form')?.addEventListener('submit',async event=>{
  event.preventDefault();setMessage('');if(!event.currentTarget.reportValidity())return;
  const data=new FormData(event.currentTarget);const submit=event.currentTarget.querySelector('[type=submit]');submit.disabled=true;
  try{await submitAuth('/api/auth/signin',{email:String(data.get('email')).trim(),password:String(data.get('password'))})}catch(error){setMessage(error.message,true);submit.disabled=false}
});

document.querySelector('#signup-form')?.addEventListener('submit',async event=>{
  event.preventDefault();setMessage('');if(!event.currentTarget.reportValidity())return;
  const data=new FormData(event.currentTarget);const submit=event.currentTarget.querySelector('[type=submit]');submit.disabled=true;
  try{await submitAuth('/api/auth/signup',{name:String(data.get('name')).trim(),email:String(data.get('email')).trim(),password:String(data.get('password')),updates:data.has('updates')})}catch(error){setMessage(error.message,true);submit.disabled=false}
});
