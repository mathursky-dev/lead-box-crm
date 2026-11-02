import { NextResponse, type NextRequest } from "next/server";
import { connectorByToken } from "@/lib/lead-hooks";
import { widgetConfig } from "@/lib/widget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Website chat widget script: <script src="https://wacrm.leadboxs.in/api/widget/TOKEN" async></script>
// Shows a floating WhatsApp button. The visitor leaves name + mobile (lead goes to the CRM),
// then WhatsApp opens with their message to the company's number.
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await connectorByToken("widget", token.replace(/\.js$/, ""));
  const headers = { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" };
  if (!c || !c.is_active) return new NextResponse("/* Lead Box widget: not found or paused */", { status: 200, headers });
  const cfg = widgetConfig(c.config);
  const endpoint = `${req.nextUrl.origin}/api/hooks/widget/${c.token}`;
  const data = JSON.stringify({ ...cfg, endpoint }).replace(/</g, "\\u003c");
  return new NextResponse(SCRIPT.replace("__CFG__", data), { status: 200, headers });
}

const SCRIPT = `(function(){
if(window.__leadboxWidget)return;window.__leadboxWidget=1;
var C=__CFG__;
var d=document,side=C.position==="left"?"left":"right",F="font-family:inherit;box-sizing:border-box;width:100%;";
function el(t,s,h){var e=d.createElement(t);if(s)e.style.cssText=s;if(h!=null)e.innerHTML=h;return e;}
function esc(s){return String(s||"").replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
var root=el("div","position:fixed;bottom:20px;"+side+":20px;z-index:2147483000;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif");
var wa='<svg viewBox="0 0 32 32" width="30" height="30" fill="#fff" aria-hidden="true"><path d="M16 3C8.8 3 3 8.7 3 15.8c0 2.5.7 4.9 2 7L3 29l6.4-2c2 1.1 4.3 1.7 6.6 1.7 7.2 0 13-5.7 13-12.8S23.2 3 16 3zm0 23.4c-2.1 0-4.1-.6-5.9-1.7l-.4-.3-3.8 1.2 1.2-3.7-.3-.4a10.4 10.4 0 0 1-1.6-5.6C5.2 10 10 5.3 16 5.3S26.8 10 26.8 15.8 22 26.4 16 26.4zm5.9-7.8c-.3-.2-1.9-1-2.2-1.1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.3-.2-.3 0-.5.1-.7l.5-.6.3-.5c.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.2 1.4 3.4c.2.2 2.4 3.6 5.8 5 .8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.1-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"/></svg>';
var btn=el("button","width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;background:"+C.color+";box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;margin-"+(side==="right"?"left":"right")+":auto",wa);
btn.setAttribute("aria-label",C.button_text||"Chat on WhatsApp");
var label=C.button_text?el("div","position:absolute;bottom:14px;"+side+":68px;background:#fff;color:#111;padding:6px 10px;border-radius:8px;font-size:13px;box-shadow:0 2px 10px rgba(0,0,0,.15);white-space:nowrap",esc(C.button_text)):null;
var box=el("div","display:none;width:300px;max-width:calc(100vw - 40px);background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);overflow:hidden;margin-bottom:12px");
box.innerHTML='<div style="background:'+C.color+';color:#fff;padding:14px 16px"><div style="font-weight:700;font-size:15px">'+esc(C.title)+'</div><div style="font-size:12px;opacity:.9;margin-top:2px">'+esc(C.subtitle)+'</div></div>'+
'<form style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">'+
'<div style="background:#f1f5f9;border-radius:10px;padding:8px 10px;font-size:13px;color:#334155">'+esc(C.greeting)+'</div>'+
(C.ask_details?'<input name="name" required maxlength="100" placeholder="Your name" style="'+F+'border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:14px">'+
'<input name="phone" required type="tel" maxlength="20" placeholder="Mobile number" style="'+F+'border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:14px">':'')+
'<textarea name="message" rows="2" maxlength="500" placeholder="Type your message" style="'+F+'border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:14px;resize:none">'+esc(C.message)+'</textarea>'+
'<input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">'+
'<div data-err style="color:#dc2626;font-size:12px;display:none"></div>'+
'<button type="submit" style="background:'+C.color+';color:#fff;border:0;border-radius:8px;padding:10px;font-weight:600;font-size:14px;cursor:pointer">Start chat on WhatsApp</button>'+
'<div style="text-align:center;font-size:10px;color:#94a3b8">Powered by Lead Box</div></form>';
var form=box.querySelector("form"),err=box.querySelector("[data-err]");
function openWa(msg){if(!C.wa_number)return;window.open("https://wa.me/"+C.wa_number+"?text="+encodeURIComponent(msg||C.message||"Hi"),"_blank","noopener");}
form.addEventListener("submit",function(e){e.preventDefault();var f=new FormData(form),msg=String(f.get("message")||"");
if(!C.ask_details){openWa(msg);return;}
var b=form.querySelector("button[type=submit]");b.disabled=true;err.style.display="none";
var w=null;try{w=C.wa_number?window.open("about:blank","_blank"):null;}catch(x){}
fetch(C.endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:f.get("name"),phone:f.get("phone"),message:msg,website:f.get("website"),page:location.href})})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
.then(function(x){b.disabled=false;if(!x.ok){if(w)w.close();err.textContent=(x.j&&x.j.error)||"Please check your mobile number.";err.style.display="block";return;}
var url="https://wa.me/"+C.wa_number+"?text="+encodeURIComponent(msg||C.message||"Hi");
if(w){w.location.href=url;}else if(C.wa_number){location.href=url;}
form.innerHTML='<div style="padding:10px 0;text-align:center;font-size:14px;color:#0f172a">'+esc(C.thank_you)+'</div>';})
.catch(function(){b.disabled=false;if(w)w.close();err.textContent="Could not send. Please try again.";err.style.display="block";});});
btn.addEventListener("click",function(){var o=box.style.display==="none";box.style.display=o?"block":"none";if(label)label.style.display=o?"none":"block";});
root.appendChild(box);var wrap=el("div","position:relative");if(label)wrap.appendChild(label);wrap.appendChild(btn);root.appendChild(wrap);
(d.body?Promise.resolve():new Promise(function(r){d.addEventListener("DOMContentLoaded",r);})).then(function(){d.body.appendChild(root);});
})();`;
