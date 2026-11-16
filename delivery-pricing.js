(function(){
  function calculate(lines,config,itemCount,freeDeliveryCount){
    const count=Number(itemCount)||lines.reduce((sum,line)=>sum+Number(line.qty||0),0);
    const subtotal=lines.reduce((sum,line)=>sum+Number(line.product?.price||0)*Number(line.qty||0),0);
    const allWeight=lines.reduce((sum,line)=>sum+(Number(line.product?.weightKg)||0.5)*Number(line.qty||0),0);
    const chargeableWeight=lines.reduce((sum,line)=>sum+(line.product?.freeDelivery===true?0:(Number(line.product?.weightKg)||0.5)*Number(line.qty||0)),0);
    const campaignWaived=freeDeliveryCount>0&&count>=freeDeliveryCount;
    const weightPricing=config?.weightDelivery?.enabled===true;
    const rate=Math.max(0,Number(config?.weightDelivery?.ratePerKg)||0);
    let amount,label;
    if(campaignWaived){amount=0;label='Delivery · free item offer'}
    else if(weightPricing){amount=Math.round(chargeableWeight*rate*100)/100;label=chargeableWeight?`Delivery · ${chargeableWeight.toFixed(2)} kg × ${rate.toFixed(2)}/kg`:'Delivery · free';}
    else {amount=subtotal>=35||chargeableWeight===0?0:3.95;label='Delivery';}
    return {amount,label,allWeight,chargeableWeight,weightPricing,rate};
  }
  window.PennyBuysDelivery={calculate};
})();
