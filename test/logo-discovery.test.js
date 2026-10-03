import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPublicAddress,normalizeWebsite,logoCandidates} from '../logo-discovery.js';
test('crawler rejects local and private network addresses',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','fe80::1','fc00::1','::ffff:127.0.0.1'])assert.equal(isPublicAddress(ip),false,ip);
 assert.equal(isPublicAddress('8.8.8.8'),true);assert.equal(isPublicAddress('2606:4700:4700::1111'),true);
});
test('website input requires HTTPS and no embedded credentials',()=>{
 assert.equal(normalizeWebsite('example.com'),'https://example.com/');
 for(const value of ['http://example.com','https://user:pass@example.com','https://example.com:8080','https://localhost','file:///etc/passwd'])assert.throws(()=>normalizeWebsite(value));
});
test('logo discovery prefers structured branding and resolves relative assets',()=>{
 const html='<script type="application/ld+json">{"@type":"Organization","logo":"/brand.svg"}</script><img alt="Company logo" src="/logo.png"><link rel="apple-touch-icon" href="/icon.png"><img src="/irrelevant.jpg">';
 assert.deepEqual(logoCandidates(html,'https://example.com/'),['https://example.com/brand.svg','https://example.com/logo.png','https://example.com/icon.png']);
 assert.deepEqual(logoCandidates('<img alt="logo" src="javascript:alert(1)">','https://example.com'),[]);
});
