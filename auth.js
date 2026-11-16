const usersKey='pennybuys-demo-users';
const sessionKey='pennybuys-demo-session';
const mode=document.body.dataset.authMode;
const message=document.querySelector('#auth-message');
const emailForm=document.querySelector('#email-login-form');
function setMessage(text,isError=false){message.textContent=text;message.classList.toggle('is-error',isError)}
function readUsers(){try{return JSON.parse(localStorage.getItem(usersKey)||'[]')}catch{return []}}
function setSession(user){localStorage.setItem(sessionKey,JSON.stringify({email:user.email,name:user.name,signedInAt:new Date().toISOString()}))}
function bytesToHex(bytes){return [...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
async function hashPassword(password,salt){const data=new TextEncoder().encode(`${salt}:${password}`);return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256',data)))}
function randomToken(){const bytes=crypto.getRandomValues(new Uint8Array(24));return bytesToHex(bytes)}
if(!crypto?.subtle){setMessage('Secure sign-in needs a modern browser and a secure connection.',true)}

document.querySelectorAll('.password-toggle').forEach(button=>button.addEventListener('click',()=>{
  const input=button.parentElement.querySelector('input');const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'Hide':'Show';button.setAttribute('aria-label',show?'Hide password':'Show password');
}));

document.querySelectorAll('[data-google-auth]').forEach(button=>button.addEventListener('click',()=>setMessage('Google sign-in is not connected yet. Connect Google OAuth to enable this option.',true)));

const passwordForm=document.querySelector('#password-form');
passwordForm?.addEventListener('submit',async event=>{
  event.preventDefault();setMessage('');
  if(!event.currentTarget.reportValidity())return;
  const data=new FormData(event.currentTarget);const email=String(data.get('email')).trim().toLowerCase();const password=String(data.get('password'));
  const user=readUsers().find(item=>item.email===email);
  if(!user){setMessage('We couldn’t find an account with that email. Create an account to get started.',true);return}
  try{const hash=await hashPassword(password,user.salt);if(hash!==user.passwordHash){setMessage('That password doesn’t match this account. Please try again.',true);return}setSession(user);window.location.href='index.html'}catch{setMessage('Sign-in is unavailable right now. Please try again.',true)}
});

document.querySelector('#email-login-toggle')?.addEventListener('click',()=>{emailForm.hidden=!emailForm.hidden;if(!emailForm.hidden)emailForm.querySelector('input').focus()});
emailForm?.addEventListener('submit',event=>{
  event.preventDefault();const result=document.querySelector('#email-link-result');result.textContent='';
  if(!event.currentTarget.reportValidity())return;
  const email=String(new FormData(event.currentTarget).get('email')).trim().toLowerCase();
  const user=readUsers().find(item=>item.email===email);
  if(!user){result.textContent='If you already have an account, check the email address and try again.';return}
  const token=randomToken();sessionStorage.setItem(`pennybuys-email-link-${token}`,email);
  result.innerHTML=`A sign-in link is ready for this demo. Email delivery is not connected. <a href="signin.html?email_link=${encodeURIComponent(token)}">Continue with the demo email link →</a>`;
});

document.querySelector('#signup-form')?.addEventListener('submit',async event=>{
  event.preventDefault();setMessage('');if(!event.currentTarget.reportValidity())return;
  const data=new FormData(event.currentTarget);const email=String(data.get('email')).trim().toLowerCase();const name=String(data.get('name')).trim();const password=String(data.get('password'));
  if(readUsers().some(user=>user.email===email)){setMessage('An account with that email already exists. Please sign in.',true);return}
  try{const salt=bytesToHex(crypto.getRandomValues(new Uint8Array(16)));const user={email,name,salt,passwordHash:await hashPassword(password,salt),updates:data.has('updates')};const users=readUsers();users.push(user);localStorage.setItem(usersKey,JSON.stringify(users));setSession(user);window.location.href='index.html'}catch{setMessage('We couldn’t create your account. Please try again.',true)}
});

const loginToken=new URLSearchParams(location.search).get('email_link');
if(loginToken){const key=`pennybuys-email-link-${loginToken}`;const email=sessionStorage.getItem(key);const user=readUsers().find(item=>item.email===email);if(user){sessionStorage.removeItem(key);setSession(user);window.location.replace('index.html')}else setMessage('That email sign-in link is expired or was already used. Request a new one.',true)}
