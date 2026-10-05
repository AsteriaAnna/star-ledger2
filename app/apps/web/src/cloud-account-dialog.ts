import {cloudAccountMessages} from './cloud-account-messages.ts';
import {registerCloudAccount,signInCloudAccount} from './account-onboarding.ts';
type DialogHost={modal:(title:string,body:string)=>void;close:()=>void;refresh:()=>Promise<void>;toast:(message:string)=>void;error:(error:Error)=>void};
export function openCloudAccountDialog(host:DialogHost,mode:'login'|'register'='login',username=''){
 const registering=mode==='register';
 host.modal(registering?'受邀注册':'登录个人账户',`<form id="cloud-login-form"><label>用户名<input name="username" autocomplete="username" maxlength="24" required></label><label>密码<input name="password" type="password" autocomplete="${registering?'new-password':'current-password'}" ${registering?'minlength="8" maxlength="32"':''} required></label>${registering?'<label>确认密码<input name="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="32" required></label><label>邀请码<input name="invitation" autocomplete="off" maxlength="43" required></label><p class="footnote">仅向受邀的人开放。请使用邀请人提供的用户名和邀请码。密码为 8–32 位，包含大写字母、小写字母、数字、符号中的至少三类，以字母或数字开头，不含空白；支持 ()!@#$%^&amp;*|?&gt;&lt;_- 符号。</p>':'<p class="footnote">登录后打开你的个人账本。连接云同步后，可在登录同一账户的设备间同步；离线时仍可保存在本机。</p>'}<p id="cloud-account-feedback" role="status" aria-live="polite"></p><div class="modal-actions"><button type="button" class="secondary" data-close>取消</button><button type="submit" class="primary">${registering?'注册并登录':'登录'}</button></div><button type="button" class="text-button" id="cloud-account-switch">${registering?'已有账号？去登录':'收到邀请？注册账户'}</button></form>`);
 const form=document.querySelector<HTMLFormElement>('#cloud-login-form')!,feedback=form.querySelector<HTMLElement>('#cloud-account-feedback')!;
 form.elements.namedItem('username')&&((form.elements.namedItem('username') as HTMLInputElement).value=username);
 const input=(name:string)=>form.querySelector<HTMLInputElement>(`[name=${name}]`)!;
 const clearSecrets=()=>{for(const field of form.querySelectorAll<HTMLInputElement>('input[type=password],input[name=invitation]'))field.value='';};
 let busy=false,created=false;
 const dialog=form.closest('dialog')!;
 const busyControls=()=>dialog.querySelectorAll<HTMLInputElement|HTMLButtonElement>('input,button');
 const preventPendingClose=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();};
 form.querySelector<HTMLButtonElement>('#cloud-account-switch')!.onclick=()=>{const name=input('username').value;clearSecrets();openCloudAccountDialog(host,registering?'login':'register',name);};
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const name=input('username').value.trim(),password=input('password').value;
  if(registering&&password!==input('confirmation').value){feedback.textContent='两次输入的密码不一致';return;}
  if(registering&&(!/^[A-Za-z0-9][A-Za-z0-9_.-]{4,23}$/.test(name)||!/^[A-Za-z0-9][A-Za-z0-9()!@#$%^&*|?><_-]{7,31}$/.test(password)||[/[A-Z]/,/[a-z]/,/[0-9]/,/[()!@#$%^&*|?><_-]/].filter(rule=>rule.test(password)).length<3)){feedback.textContent='请按说明填写用户名和密码；用户名为 5–24 位字母、数字、点、下划线或短横线，以字母或数字开头';return;}
  busy=true;dialog.addEventListener('cancel',preventPendingClose,{capture:true});busyControls().forEach(control=>control.disabled=true);feedback.textContent=registering?'正在创建账户，请稍候':'正在登录，请稍候';
  try{
   if(registering){await registerCloudAccount(name,password,input('invitation').value);created=true;feedback.textContent='账户已创建，正在登录';}
   const result=await signInCloudAccount(name,password);await host.refresh();host.close();
   if(result.syncError){host.toast('已登录，云同步尚未连接');host.error(result.syncError);}else host.toast('已登录，账本已同步');
  }catch(error){
   if(created){clearSecrets();openCloudAccountDialog(host,'login',name);host.toast('账户已创建，请登录；无需重新注册');}
   const failure=error instanceof Error?error:Error('CLOUDBASE_AUTH_FAILED');feedback.textContent=cloudAccountMessages[failure.message]||'账户操作未完成，请稍后重试';host.error(failure);
  }finally{dialog.removeEventListener('cancel',preventPendingClose,{capture:true});clearSecrets();busy=false;busyControls().forEach(control=>control.disabled=false);}
 };
}
