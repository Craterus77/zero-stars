import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function isPublicAddress(address) {
  if (isIP(address) === 6) {
    const value = address.toLowerCase();
    return /^[23]/.test(value) && !value.startsWith('2001:db8:');
  }
  if (isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a===0 || a===10 || a===127 || a>=224 || (a===100&&b>=64&&b<=127) || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===192&&b===0) || (a===198&&(b===18||b===19||b===51)) || (a===203&&b===0&&c===113));
}
export function normalizeWebsite(value) {
  const raw=String(value||'').trim();
  if(!raw)return '';
  const url=new URL(/^[a-z][a-z\d+.-]*:/i.test(raw)?raw:'https://'+raw);
  if(url.protocol!=='https:' || url.username || url.password || (url.port&&url.port!=='443') || !url.hostname.includes('.') || url.hostname.endsWith('.local') || url.hostname.endsWith('.internal')) throw new Error('Use a public HTTPS business website, without login details.');
  url.hash='';return url.toString();
}
async function publicTarget(value) {
  const url=new URL(normalizeWebsite(value));
  const addresses=await lookup(url.hostname,{all:true});
  if(!addresses.length||addresses.some(({address})=>!isPublicAddress(address)))throw new Error('This is not a public website.');
  return {url,address:addresses[0]};
}
async function readHomepage(value,redirects=0) {
  const {url,address}=await publicTarget(value);
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{headers:{'User-Agent':'ZeroStarsLogoFinder/1.0','Accept':'text/html'},lookup:(_host,options,callback)=>options.all?callback(null,[address]):callback(null,address.address,address.family)},response=>{
      if(response.statusCode>=300&&response.statusCode<400&&response.headers.location){response.resume();if(redirects>=3)return reject(new Error('Too many redirects.'));return resolve(readHomepage(new URL(response.headers.location,url).href,redirects+1));}
      if(response.statusCode!==200||!String(response.headers['content-type']).includes('text/html')){response.resume();return reject(new Error('No readable homepage.'));}
      const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>512000){request.destroy(new Error('Homepage too large.'));return;}chunks.push(chunk);});response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8'),url:url.href}));response.on('error',reject);
    });
    request.setTimeout(4000,()=>request.destroy(new Error('Website timed out.')));request.on('error',reject);
  });
}
function attributes(tag){const values={};for(const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))values[match[1].toLowerCase()]=(match[2]??match[3]??match[4]).replace(/&amp;/g,'&');return values;}
export function logoCandidates(html,base) {
  const candidates=[];
  for(const script of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const data=JSON.parse(script[1]);const visit=(item,depth=0)=>{if(!item||depth>5)return;if(Array.isArray(item))return item.slice(0,20).forEach(x=>visit(x,depth+1));if(typeof item==='object'){const logo=item.logo;const url=typeof logo==='string'?logo:logo?.url||logo?.contentUrl;if(url)candidates.push(url);if(item['@graph'])visit(item['@graph'],depth+1);}};visit(data);}catch{}
  }
  for(const tag of html.matchAll(/<img\b[^>]*>/gi)){const a=attributes(tag[0]);if(/logo/i.test([a.alt,a.class,a.id,a.src].join(' ')))candidates.push(a.src||a['data-src']);}
  for(const tag of html.matchAll(/<link\b[^>]*>/gi)){const a=attributes(tag[0]);if(/(?:apple-touch-icon|(?:^|\s)icon(?:\s|$))/i.test(a.rel||''))candidates.push(a.href);}
  for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){const a=attributes(tag[0]);if(a.property==='og:logo')candidates.push(a.content);}
  return [...new Set(candidates.filter(Boolean).flatMap(candidate=>{try{return [normalizeWebsite(new URL(candidate,base).href)];}catch{return []}}))].slice(0,6);
}
const cache=new Map();
export async function discoverLogo(value) {
  const website=normalizeWebsite(value);if(!website)return {website:'',logoUrl:''};
  const cached=cache.get(website);if(cached&&cached.until>Date.now())return cached.result;
  let logoUrl='';
  try{const {html,url}=await readHomepage(website);for(const candidate of logoCandidates(html,url)){try{await publicTarget(candidate);logoUrl=candidate;break;}catch{}}}catch{}
  const result={website,logoUrl};if(cache.size>500)cache.clear();cache.set(website,{until:Date.now()+3600000,result});return result;
}
