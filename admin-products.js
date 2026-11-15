const tokenKey='pennybuys-admin-session-token';
const loginPanel=document.querySelector('#admin-login');
const dashboard=document.querySelector('#admin-dashboard');
const tokenInput=document.querySelector('#admin-token');
const loginMessage=document.querySelector('#login-message');
const serviceStatus=document.querySelector('#service-status');
const productList=document.querySelector('#product-list');
const productCount=document.querySelector('#product-count');
const productForm=document.querySelector('#product-form');
const productMessage=document.querySelector('#product-message');
const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let adminToken=sessionStorage.getItem(tokenKey)||'';

function showLogin(message=''){
  loginPanel.hidden=false;dashboard.hidden=true;document.querySelector('#admin-logout').hidden=true;
  loginMessage.textContent=message;loginMessage.classList.remove('success');
}
function showDashboard(){
  loginPanel.hidden=true;dashboard.hidden=false;document.querySelector('#admin-logout').hidden=false;
}
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{...(options.headers||{}),'x-admin-token':adminToken}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
  return data;
}
function renderProducts(products){
  productCount.textContent=products.length;
  productList.innerHTML=products.length?products.map(product=>`<article class="inventory-card"><img src="${escapeHTML(product.image)}" alt="" loading="lazy"><div><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.category)}${product.video?' | video':''}</p><small>Stock: ${Number(product.inventory??0)} | ${Number(product.gallery?.length||0)+1} image${product.gallery?.length?'s':''}</small></div><strong>GBP ${Number(product.price).toFixed(2)}</strong></article>`).join(''):'<div class="inventory-empty">No products are available yet.</div>';
}
async function loadProducts(){
  const products=await api('/api/products');
  renderProducts(products);
}
async function connectAdmin(candidate){
  adminToken=candidate;
  const status=await api('/api/admin/status');
  sessionStorage.setItem(tokenKey,adminToken);
  showDashboard();
  const ready=status.mongoConnected&&status.cloudinaryConfigured;
  serviceStatus.classList.toggle('ready',ready);
  serviceStatus.innerHTML=`<strong>${ready?'Services ready':'Setup needed'}</strong><span>MongoDB: ${status.mongoConnected?'connected':'not connected'}</span><span>Cloudinary: ${status.cloudinaryConfigured?'configured':'not configured'}</span>${ready?'':'<span>Set MONGODB_URI and Cloudinary credentials in your server environment before uploading.</span>'}`;
  await loadProducts();
}
document.querySelector('#admin-login-form').addEventListener('submit',async event=>{
  event.preventDefault();loginMessage.textContent='Checking access...';
  try{await connectAdmin(tokenInput.value.trim());loginMessage.textContent='';}
  catch(error){showLogin(error.message);adminToken='';sessionStorage.removeItem(tokenKey);}
});
document.querySelector('#admin-logout').addEventListener('click',()=>{sessionStorage.removeItem(tokenKey);adminToken='';showLogin('You have signed out.')});
document.querySelector('#refresh-products').addEventListener('click',async event=>{
  event.currentTarget.disabled=true;
  try{await loadProducts();}catch(error){productMessage.textContent=error.message;}
  event.currentTarget.disabled=false;
});
document.querySelector('[name="category"]').addEventListener('change',event=>{
  productForm.elements.group.value=event.currentTarget.selectedOptions[0]?.dataset.group||'';
});
document.querySelector('[name="images"]').addEventListener('change',event=>{
  const files=[...event.currentTarget.files].slice(0,5);
  document.querySelector('#image-preview').innerHTML=files.map(file=>`<img src="${URL.createObjectURL(file)}" alt="Preview of ${escapeHTML(file.name)}">`).join('');
});
productForm.addEventListener('submit',async event=>{
  event.preventDefault();productMessage.classList.remove('success');productMessage.textContent='Uploading media and saving product...';
  const button=document.querySelector('#save-product');button.disabled=true;
  try{
    const response=await api('/api/products',{method:'POST',body:new FormData(productForm)});
    window.STORE_PRODUCTS=response.products;
    productForm.reset();document.querySelector('#image-preview').replaceChildren();
    productMessage.textContent=`${response.product.name} was added to the catalog.`;productMessage.classList.add('success');
    renderProducts(response.products);
  }catch(error){productMessage.textContent=error.message;}
  button.disabled=false;
});

if(adminToken){connectAdmin(adminToken).catch(error=>{sessionStorage.removeItem(tokenKey);adminToken='';showLogin(error.message)})}else showLogin();
