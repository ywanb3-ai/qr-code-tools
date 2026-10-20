/**
 * parse.test.js — unit tests for js/parse.js (run: node tests/parse.test.js)
 * Pure Node, no dependencies. Exits non-zero on failure.
 */
'use strict';

global.window = globalThis;
require('../js/parse.js');
var P = globalThis.QRParse;

var pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL:', name, extra == null ? '' : extra); }
}
function eq(name, actual, expected) {
  check(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

/* ---- Wi-Fi ---- */
var r = P.parse('WIFI:T:WPA;S:MyNet;P:secret\\;123;H:true;;');
eq('wifi type', r.type, 'wifi');
eq('wifi ssid', r.form.ssid, 'MyNet');
eq('wifi password (escaped semicolon)', r.form.password, 'secret;123');
eq('wifi hidden', r.form.hidden, true);
eq('wifi security', r.form.security, 'WPA');

r = P.parse('WIFI:S:OpenNet;T:nopass;;');
eq('open wifi security', r.form.security, 'none');
eq('open wifi password', r.form.password, '');

r = P.parse('WIFI:T:WEP;S:Legacy;P:abc;;');
eq('wep security', r.form.security, 'WEP');

/* ---- vCard ---- */
r = P.parse('BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane Doe\r\nTEL;TYPE=CELL:+15550100\r\nEMAIL:jane@x.com\r\nORG:Acme\r\nURL:https://acme.com\r\nEND:VCARD');
eq('vcard type', r.type, 'contact');
eq('vcard name', r.form.name, 'Jane Doe');
eq('vcard phone', r.form.phone, '+15550100');
eq('vcard email', r.form.email, 'jane@x.com');
eq('vcard org', r.form.org, 'Acme');
eq('vcard website', r.form.website, 'https://acme.com');
check('vcard has save action', r.actions.some(function (a) { return a.id === 'save-vcf'; }));

/* folded vCard line (RFC 2425): CRLF + one leading space is the fold marker,
   which is removed on unfold; any additional spaces are content */
r = P.parse('BEGIN:VCARD\nVERSION:3.0\nFN:Jane\n  Doe\nEND:VCARD');
eq('vcard folded line', r.form.name, 'Jane Doe');

/* ---- VEVENT ---- */
r = P.parse('BEGIN:VEVENT\nSUMMARY:Meeting\nDTSTART:20261020T090000\nDTEND:20261020T100000\nLOCATION:Room A\nDESCRIPTION:Talk\nEND:VEVENT');
eq('event type', r.type, 'event');
eq('event startDate', r.form.startDate, '2026-10-20');
eq('event startTime', r.form.startTime, '09:00');
eq('event endTime', r.form.endTime, '10:00');
eq('event title', r.form.title, 'Meeting');
eq('event location', r.form.location, 'Room A');

/* all-day event (no time) */
r = P.parse('BEGIN:VEVENT\nSUMMARY:Holiday\nDTSTART:20261225\nEND:VEVENT');
eq('all-day startTime empty', r.form.startTime, '');

/* ---- geo ---- */
r = P.parse('geo:48.8584,2.2945');
eq('geo type', r.type, 'location');
eq('geo lat', r.form.lat, '48.8584');
eq('geo lng', r.form.lng, '2.2945');
check('geo map action', r.actions.some(function (a) { return a.id === 'open-map' && a.url === 'https://www.google.com/maps/search/?api=1&query=48.8584,2.2945'; }));
r = P.parse('GEO:-33.8688,151.2093');
eq('GEO uppercase', r.type, 'location');
eq('GEO negative lat', r.form.lat, '-33.8688');

/* ---- mailto / MATMSG ---- */
r = P.parse('mailto:a@b.com?subject=Hi%20there&body=Line1');
eq('mailto type', r.type, 'email');
eq('mailto to', r.form.to, 'a@b.com');
eq('mailto subject', r.form.subject, 'Hi there');
eq('mailto body', r.form.body, 'Line1');

r = P.parse('MATMSG:TO:a@b.com;SUB:Hello;BODY:World;;');
eq('matmsg type', r.type, 'email');
eq('matmsg to', r.form.to, 'a@b.com');
eq('matmsg subject', r.form.subject, 'Hello');
eq('matmsg body', r.form.body, 'World');

/* ---- SMS ---- */
r = P.parse('SMSTO:+15550100:Hello world');
eq('smsto type', r.type, 'sms');
eq('smsto number', r.form.number, '+15550100');
eq('smsto message', r.form.message, 'Hello world');

r = P.parse('sms:+15550100?body=Hi');
eq('sms: type', r.type, 'sms');
eq('sms: message', r.form.message, 'Hi');

/* ---- tel / phone ---- */
r = P.parse('tel:+15550100');
eq('tel type', r.type, 'phone');
eq('tel number', r.form.number, '+15550100');

/* ---- URL ---- */
r = P.parse('https://example.com/path?q=1');
eq('url type', r.type, 'url');
eq('url host', r.linkHost, 'example.com');
eq('url form', r.form.url, 'https://example.com/path?q=1');

r = P.parse('example.com/page');
eq('bare domain type', r.type, 'url');
eq('bare domain normalized', r.form.url, 'https://example.com/page');

/* email-like text must NOT become url */
r = P.parse('someone@example.com');
eq('email text stays text', r.type, 'text');

/* ---- text ---- */
r = P.parse('Just some plain text');
eq('text type', r.type, 'text');
eq('text form', r.form.text, 'Just some plain text');

/* ---- MECARD ---- */
r = P.parse('MECARD:N:John Smith;TEL:+15550100;EMAIL:john@x.com;;');
eq('mecard type', r.type, 'contact');
eq('mecard name', r.form.name, 'John Smith');
eq('mecard phone', r.form.phone, '+15550100');

/* ---- buildVcard round-trip ---- */
var vcf = P.buildVcard({ name: 'Jane Doe', tel: '+15550100', email: 'jane@x.com', org: 'Acme', url: 'https://acme.com' });
check('vcf has BEGIN/END', vcf.indexOf('BEGIN:VCARD') >= 0 && vcf.indexOf('END:VCARD') >= 0);
check('vcf has FN', vcf.indexOf('FN:Jane Doe') >= 0);
check('vcf has TEL', vcf.indexOf('TEL;TYPE=CELL:+15550100') >= 0);
check('vcf no blank lines', !/\r\n\r\n/.test(vcf) && !/\n\n/.test(vcf));
var r2 = P.parse(vcf);
eq('vcf round-trip name', r2.form.name, 'Jane Doe');
eq('vcf round-trip phone', r2.form.phone, '+15550100');
eq('vcf round-trip email', r2.form.email, 'jane@x.com');
eq('vcf round-trip org', r2.form.org, 'Acme');
eq('vcf round-trip website', r2.form.website, 'https://acme.com');

/* buildVcard omits empty fields */
var vcf2 = P.buildVcard({ name: 'Only Name' });
check('vcf omits empty TEL', vcf2.indexOf('TEL') < 0);
check('vcf omits empty EMAIL', vcf2.indexOf('EMAIL') < 0);

/* ---- escape / unescape ---- */
eq('escape round-trip', P.unescapeField(P.escapeField('a;b:c,d\\e"f')), 'a;b:c,d\\e"f');

/* ---- generator encode -> parse round-trips (mirror generator.js encoders) ---- */
var enc = 'WIFI:T:WPA;S:' + P.escapeField('Home;Net') + ';P:' + P.escapeField('p:w,d') + ';';
var r3 = P.parse(enc);
eq('wifi encode->parse ssid', r3.form.ssid, 'Home;Net');
eq('wifi encode->parse password', r3.form.password, 'p:w,d');

/* every parse result carries a raw + at least one action */
['WIFI:T:WPA;S:x;P:y;;', 'BEGIN:VCARD\nFN:A\nEND:VCARD', 'https://a.com', 'plain text', 'tel:+1555', 'geo:1,2'].forEach(function (raw) {
  var res = P.parse(raw);
  check('result carries raw: ' + raw.slice(0, 20), res.raw === raw);
  check('result has copy-raw action: ' + raw.slice(0, 20), res.actions.some(function (a) { return a.id === 'copy-raw'; }));
  check('result has form: ' + raw.slice(0, 20), typeof res.form === 'object');
});

console.log('----------------------------------------');
console.log('PASS: ' + pass + '  FAIL: ' + fail);
process.exit(fail ? 1 : 0);
