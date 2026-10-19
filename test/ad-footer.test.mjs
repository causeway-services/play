import { readPublication } from "./publication.mjs";
import { indexHtml, todayHtml } from "../src/shells.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";

function sourceScript(html) {
  const embedded = html.match(/<script>([\s\S]*?)<\/script>/u);
  assert.ok(embedded, "a local static script mounts the original house ad");
  return embedded[1];
}

for (const [label, html] of [
  ["shelf",indexHtml("",[])],
  ["daily games",todayHtml("","2026-10-19")],
]) {
  test(label + " has a first-party, context-qualified ad receiver",()=>{
    assert.match(html, /id="house-ad-footer"/u);
    assert.match(html, /data-slot="footer"/u);
    assert.match(html, /data-property="play-561-group"/u);
    assert.match(html, /data-context="games"/u);
    assert.match(html, /data-ad-server="https:\/\/ads\.561\.group\/"/u);
    assert.match(html, /creative\.relationship !== "house"/u, "no third-party ad silently treated as house");
    assert.match(html, /label\.textContent = "From the publisher"/u);
    assert.doesNotMatch(html, /a\.rel="sponsored noopener noreferrer"/u);
    assert.doesNotMatch(html, /document\.cookie/u);
  });
}

function fakeElement(tagName = "aside"){
  return { tagName, children:[], dataset:{}, appendChild(child){this.children.push(child);}, textContent:"", rel:"", href:"" };
}
async function runPlacement(creative, withObserver=true) {
  const host=fakeElement();
  host.dataset={adServer:"https://ads.561.group/",slot:"footer",property:"play-561-group",context:"games"};
  const calls=[],timers=[],events=[];
  const document={
    visibilityState:"visible",
    getElementById:id=>id==="house-ad-footer"?host:null,
    createElement:fakeElement,
    createTextNode:text=>({tagName:"#text",textContent:text}),
    addEventListener:(key,fn)=>events.push([key,fn]),
  };
  let observer=null;
  class Observer{
    constructor(callback,options){observer={callback,options};}
    observe(target){assert.equal(target,host);}
  }
  const fetch=(url,options)=>{calls.push({url,options});return Promise.resolve({
    ok:true,
    json:async()=>({creative}),
  });};
  const script=sourceScript(indexHtml("",[]));
  runInNewContext(script, {
    document,fetch,URL,URLSearchParams,encodeURIComponent,Promise,
    ...(withObserver?{IntersectionObserver:Observer}:{}),
    setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},
    clearTimeout:()=>{},
  });
  await new Promise(resolve=>setImmediate(resolve));
  return {host,calls,timers,observer,document,events};
}

test("an actual selected first-party campaign retains source context and renders a truthful link",async()=>{
  const r=await runPlacement({
    id:"561-group-sustaining-support-20261019",
    relationship:"house",
    title:"Keep the commons open",
    body:"Sustain public work for $10 per month; cancel anytime.",
  });
  assert.equal(r.calls.length,1,"ad request is not a billable view");
  const query=new URL(r.calls[0].url);
  assert.equal(query.pathname,"/ad");
  assert.equal(query.searchParams.get("property"),"play-561-group");
  assert.equal(query.searchParams.get("context"),"games");
  assert.equal(r.calls[0].options.credentials,"omit");
  assert.equal(r.host.children.length,2);
  assert.equal(r.host.children[0].textContent,"From the publisher");
  const a=r.host.children[1];
  assert.match(a.href,/\/click\?/u);
  assert.equal(new URL(a.href).searchParams.get("creative"),"561-group-sustaining-support-20261019");
  assert.equal(new URL(a.href).searchParams.get("context"),"games");
  assert.equal(a.rel,"noopener noreferrer");
  assert.equal(a.children[0].textContent,"Keep the commons open");
  assert.deepEqual(Array.from(r.observer.options.threshold),[0,0.5]);
  r.observer.callback([{target:r.host,isIntersecting:true,intersectionRatio:0.49}]);
  assert.equal(r.timers.length,0);
  r.observer.callback([{target:r.host,isIntersecting:true,intersectionRatio:0.5}]);
  assert.equal(r.timers.length,1);
  assert.equal(r.timers[0].delay,1000);
  r.timers[0].fn();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(r.calls.length,2);
  assert.equal(new URL(r.calls[1].url).pathname,"/view");
  assert.equal(r.calls[1].options.method,"POST");
  assert.equal(r.calls[1].options.credentials,"omit");
});

test("unadmitted third-party response is refused instead of misleadingly labeled",async()=>{
  const r=await runPlacement({id:"sponsor",relationship:"sponsored",title:"Paid placement",body:"Pay"});
  assert.equal(r.calls.length,1);
  assert.equal(r.host.children.length,0);
  assert.equal(r.observer,null);
});

test("without a visual observer only a request and readable house placement occur",async()=>{
  const r=await runPlacement({id:"house",relationship:"house",title:"An admitted house offer"},false);
  assert.equal(r.calls.length,1);
  assert.equal(r.host.children.length,2);
  assert.equal(r.timers.length,0);
});

test("compiled publication keeps the same local receiver, with no remote script imports",async()=>{
  const html=await readPublication("index.html");
  assert.match(html,/id="house-ad-footer"/u);
  assert.match(html,/data-context="games"/u);
  for(const m of html.matchAll(/<script\b[^>]*>/gu)){
    assert.doesNotMatch(m[0],/src="https?:/u);
  }
});
