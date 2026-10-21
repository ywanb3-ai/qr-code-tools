/**
 * parse.js — QR content protocol parser (pure functions, no DOM).
 * Exposes window.QRParse. Used by the scanner to classify results and
 * derive available actions. Kept dependency-free so it can be unit-tested
 * with plain node.
 */
(function (root) {
  'use strict';

  /** Unescape QR "structured append" style escapes used by WIFI/MECARD fields. */
  function unescapeField(value) {
    return value
      .replace(/\\(.)/g, '$1');
  }

  /** Escape a value for embedding in WIFI:/MECARD: payloads. */
  function escapeField(value) {
    return String(value == null ? '' : value)
      .replace(/([\\;,:"])/g, '\\$1');
  }

  /** Split on a delimiter, honoring backslash escapes. */
  function splitUnescaped(text, delimiter) {
    var parts = [], cur = '', i = 0;
    while (i < text.length) {
      var ch = text[i];
      if (ch === '\\' && i + 1 < text.length) {
        cur += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === delimiter) {
        parts.push(cur);
        cur = '';
        i++;
        continue;
      }
      cur += ch;
      i++;
    }
    parts.push(cur);
    return parts;
  }

  /**
   * Parse a WIFI: payload.
   * Grammar: WIFI:T:<auth>;S:<ssid>;P:<password>;H:<hidden>;;
   * T values: WPA, WEP, nopass (open). Empty payload defaults to nopass.
   */
  function parseWifi(raw) {
    var body = raw.replace(/^WIFI:/i, '');
    var fields = {};
    var i = 0, key = '', val = '', inKey = true;
    // Character-level scan honoring backslash escapes.
    while (i < body.length) {
      var ch = body[i];
      if (ch === '\\' && i + 1 < body.length) {
        if (inKey) key += body[i + 1]; else val += body[i + 1];
        i += 2;
        continue;
      }
      if (ch === ':') {
        inKey = false;
        i++;
        continue;
      }
      if (ch === ';') {
        if (key || val) fields[key.toUpperCase()] = val;
        key = ''; val = ''; inKey = true;
        i++;
        continue;
      }
      if (inKey) key += ch; else val += ch;
      i++;
    }
    if (key || val) fields[key.toUpperCase()] = val;

    var auth = (fields.T || 'nopass').toUpperCase();
    var authLabel = auth === 'NOPASS' ? 'Open (no password)' :
      auth === 'WEP' ? 'WEP' : auth === 'WPA' ? 'WPA/WPA2' : auth;

    return {
      type: 'wifi',
      label: 'WI-FI',
      summary: fields.S ? 'Wi-Fi network "' + fields.S + '"' : 'Wi-Fi network',
      fields: [
        { label: 'Network (SSID)', value: fields.S || '—', mono: true },
        { label: 'Security', value: authLabel },
        { label: 'Password', value: fields.P || '(none)', mono: true },
        { label: 'Hidden', value: fields.H === 'true' ? 'Yes' : 'No' }
      ],
      form: {
        ssid: fields.S || '',
        password: fields.P || '',
        security: auth === 'WEP' ? 'WEP' : auth === 'WPA' ? 'WPA' : 'none',
        hidden: fields.H === 'true'
      },
      actions: [
        { id: 'copy-password', kind: 'copy', label: 'Copy password', copy: fields.P || '' },
        { id: 'copy-config', kind: 'copy', label: 'Copy Wi-Fi config', copy: raw },
        { id: 'copy-ssid', kind: 'copy', label: 'Copy SSID', copy: fields.S || '' }
      ]
    };
  }

  /** Parse MECARD:N:name;TEL:..;EMAIL:..;; */
  function parseMecard(raw) {
    var body = raw.replace(/^MECARD:/i, '');
    var fields = {};
    splitUnescaped(body, ';').forEach(function (p) {
      var idx = p.indexOf(':');
      if (idx > 0) fields[p.slice(0, idx).toUpperCase()] = unescapeField(p.slice(idx + 1));
    });
    var name = fields.N || 'Contact';
    var rows = [];
    if (fields.N) rows.push({ label: 'Name', value: fields.N });
    if (fields.TEL) rows.push({ label: 'Phone', value: fields.TEL, mono: true });
    if (fields.EMAIL) rows.push({ label: 'Email', value: fields.EMAIL, mono: true });
    if (fields.ORG) rows.push({ label: 'Organization', value: fields.ORG });
    if (fields.URL) rows.push({ label: 'Website', value: fields.URL, mono: true });
    if (fields.ADR) rows.push({ label: 'Address', value: fields.ADR });
    if (fields.NOTE) rows.push({ label: 'Note', value: fields.NOTE });

    var vcf = buildVcard({ name: fields.N || 'Contact', tel: fields.TEL, email: fields.EMAIL, org: fields.ORG, url: fields.URL });
    return {
      type: 'contact',
      label: 'CONTACT',
      summary: name,
      fields: rows,
      form: {
        name: fields.N || '',
        phone: fields.TEL || '',
        email: fields.EMAIL || '',
        org: fields.ORG || '',
        website: fields.URL || ''
      },
      actions: [
        { id: 'save-vcf', kind: 'download', label: 'Save contact (.vcf)', download: { filename: (fields.N || 'contact').replace(/[^\w-]+/g, '_') + '.vcf', content: vcf } },
        { id: 'copy-raw', kind: 'copy', label: 'Copy raw', copy: raw }
      ]
    };
  }

  /** Build a minimal vCard 3.0 string from extracted fields. */
  function buildVcard(c) {
    var lines = ['BEGIN:VCARD', 'VERSION:3.0'];
    lines.push('FN:' + (c.name || 'Contact'));
    if (c.org) lines.push('ORG:' + c.org);
    if (c.tel) lines.push('TEL;TYPE=CELL:' + c.tel);
    if (c.email) lines.push('EMAIL;TYPE=INTERNET:' + c.email);
    if (c.url) lines.push('URL:' + c.url);
    if (c.adr) lines.push('ADR;TYPE=HOME:;;' + c.adr.split(',').join(';'));
    lines.push('END:VCARD');
    return lines.join('\r\n');
  }

  /** Parse a full VCARD payload, honoring folded lines (RFC 2425). */
  function parseVcard(raw) {
    // Unfold: lines starting with space/tab continue the previous line.
    var unfolded = raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    var lines = unfolded.split(/\r\n|\n/);
    var props = [];
    lines.forEach(function (line) {
      if (/^(BEGIN|END):VCARD$/i.test(line)) return;
      var idx = line.indexOf(':');
      if (idx < 0) return;
      var key = line.slice(0, idx).toUpperCase();
      var value = line.slice(idx + 1);
      var propName = key.split(';')[0];
      props.push({ prop: propName, value: value, params: key.slice(propName.length) });
    });

    function pick(names) {
      for (var i = 0; i < props.length; i++) {
        if (names.indexOf(props[i].prop) >= 0 && props[i].value) return props[i].value;
      }
      return '';
    }
    var fn = pick(['FN']) || pick(['N']);
    var name = fn.replace(/;/g, ' ').trim() || 'Contact';

    var labelMap = { TEL: 'Phone', EMAIL: 'Email', ORG: 'Organization', TITLE: 'Job title', URL: 'Website', ADR: 'Address', NOTE: 'Note', NICKNAME: 'Nickname', BDAY: 'Birthday' };
    var rows = [{ label: 'Name', value: name }];
    props.forEach(function (p) {
      if (p.prop === 'FN' || p.prop === 'N' || p.prop === 'VERSION') return;
      if (!p.value) return;
      var label = labelMap[p.prop] || p.prop;
      var value = p.prop === 'ADR' ? p.value.replace(/;/g, ', ').replace(/,+\s*,/g, ',').replace(/^,\s*|,\s*$/g, '') : p.value;
      rows.push({ label: label, value: value, mono: p.prop === 'EMAIL' || p.prop === 'URL' });
    });

    var contact = { name: name };
    props.forEach(function (p) {
      if (p.prop === 'TEL' && !contact.tel) contact.tel = p.value;
      if (p.prop === 'EMAIL' && !contact.email) contact.email = p.value;
      if (p.prop === 'ORG' && !contact.org) contact.org = p.value;
      if (p.prop === 'URL' && !contact.url) contact.url = p.value;
      if (p.prop === 'ADR' && !contact.adr) contact.adr = p.value;
    });
    var vcf = buildVcard(contact);

    var actions = [
      { id: 'save-vcf', kind: 'download', label: 'Save contact (.vcf)', download: { filename: name.replace(/[^\w-]+/g, '_') + '.vcf', content: vcf } }
    ];
    if (contact.tel) actions.push({ id: 'call', kind: 'link', label: 'Call', url: 'tel:' + contact.tel.replace(/[^\d+*#]/g, '') });
    if (contact.email) actions.push({ id: 'mail', kind: 'link', label: 'Send email', url: 'mailto:' + contact.email });
    actions.push({ id: 'copy-raw', kind: 'copy', label: 'Copy raw', copy: raw });

    return {
      type: 'contact',
      label: 'CONTACT',
      summary: name,
      fields: rows,
      form: {
        name: name,
        phone: contact.tel || '',
        email: contact.email || '',
        org: contact.org || '',
        website: contact.url || ''
      },
      actions: actions
    };
  }

  /** Parse a VEVENT payload. */
  function parseEvent(raw) {
    var unfolded = raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
    var lines = unfolded.split(/\r\n|\n/);
    var props = {};
    lines.forEach(function (line) {
      var idx = line.indexOf(':');
      if (idx < 0) return;
      var key = line.slice(0, idx).toUpperCase().split(';')[0];
      if (key === 'BEGIN' || key === 'END') return;
      if (!props[key]) props[key] = line.slice(idx + 1);
    });

    function fmtIcal(v) {
      var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(v || '');
      if (!m) return v || '';
      var d = m[1] + '-' + m[2] + '-' + m[3];
      if (!m[4]) return d;
      var t = m[4] + ':' + m[5];
      return d + ' ' + t + (m[7] ? ' UTC' : '');
    }

    var summary = props.SUMMARY || 'Calendar event';
    var rows = [
      { label: 'Event', value: summary }
    ];
    if (props.DTSTART) rows.push({ label: 'Starts', value: fmtIcal(props.DTSTART) });
    if (props.DTEND) rows.push({ label: 'Ends', value: fmtIcal(props.DTEND) });
    if (props.LOCATION) rows.push({ label: 'Location', value: props.LOCATION });
    if (props.DESCRIPTION) rows.push({ label: 'Description', value: props.DESCRIPTION });

    return {
      type: 'event',
      label: 'EVENT',
      summary: summary,
      fields: rows,
      form: splitIcalDates(props),
      actions: [
        { id: 'copy-summary', kind: 'copy', label: 'Copy event name', copy: summary },
        { id: 'copy-raw', kind: 'copy', label: 'Copy raw', copy: raw }
      ]
    };
  }

  /** Split iCal DTSTART/DTEND into generator form values (YYYY-MM-DD / HH:MM). */
  function splitIcalDates(props) {
    function split(v) {
      var m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(v || '');
      if (!m) return { date: '', time: '' };
      return { date: m[1] + '-' + m[2] + '-' + m[3], time: m[4] ? m[4] + ':' + m[5] : '' };
    }
    var s = split(props.DTSTART), e = split(props.DTEND);
    return {
      title: props.SUMMARY || '',
      location: props.LOCATION || '',
      startDate: s.date,
      startTime: s.time,
      endDate: e.date,
      endTime: e.time,
      description: (props.DESCRIPTION || '').replace(/\\n/g, '\n')
    };
  }

  /** Parse geo:lat,lng or GEO:lat,lng */
  function parseGeo(raw, lat, lng) {
    // lat/lng are validated as plain numbers by the caller, so the comma is safe unencoded.
    var mapUrl = 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lng;
    return {
      type: 'location',
      label: 'LOCATION',
      summary: 'Coordinates ' + lat + ', ' + lng,
      fields: [
        { label: 'Latitude', value: lat, mono: true },
        { label: 'Longitude', value: lng, mono: true }
      ],
      form: { lat: lat, lng: lng },
      actions: [
        { id: 'open-map', kind: 'link', label: 'Open in Google Maps', url: mapUrl },
        { id: 'copy-coords', kind: 'copy', label: 'Copy coordinates', copy: lat + ', ' + lng }
      ]
    };
  }

  /** Parse mailto: or MATMSG: payloads. */
  function parseEmail(raw, to, subject, body) {
    var rows = [{ label: 'To', value: to, mono: true }];
    if (subject) rows.push({ label: 'Subject', value: subject });
    if (body) rows.push({ label: 'Body', value: body });
    return {
      type: 'email',
      label: 'EMAIL',
      summary: to,
      fields: rows,
      form: { to: to, subject: subject || '', body: body || '' },
      actions: [
        { id: 'compose', kind: 'link', label: 'Open in mail app', url: 'mailto:' + to + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '') },
        { id: 'copy-address', kind: 'copy', label: 'Copy address', copy: to },
        { id: 'copy-raw', kind: 'copy', label: 'Copy raw', copy: raw }
      ]
    };
  }

  /** Parse SMSTO:/sms: payloads. */
  function parseSms(raw, number, message) {
    var rows = [{ label: 'Number', value: number || '—', mono: true }];
    if (message) rows.push({ label: 'Message', value: message });
    var url = 'sms:' + (number || '') + (message ? '?body=' + encodeURIComponent(message) : '');
    return {
      type: 'sms',
      label: 'SMS',
      summary: message ? 'SMS to ' + (number || '—') : 'SMS to ' + (number || '—'),
      fields: rows,
      form: { number: number || '', message: message || '' },
      actions: [
        { id: 'open-sms', kind: 'link', label: 'Open in messages', url: url },
        { id: 'copy-number', kind: 'copy', label: 'Copy number', copy: number || '' },
        { id: 'copy-raw', kind: 'copy', label: 'Copy raw', copy: raw }
      ]
    };
  }

  function parsePhone(raw, number) {
    return {
      type: 'phone',
      label: 'PHONE',
      summary: number,
      fields: [{ label: 'Number', value: number, mono: true }],
      form: { number: number },
      actions: [
        { id: 'call', kind: 'link', label: 'Call', url: 'tel:' + number.replace(/[^\d+*#]/g, '') },
        { id: 'copy-number', kind: 'copy', label: 'Copy number', copy: number }
      ]
    };
  }

  function parseUrl(raw) {
    var host = '';
    try { host = new URL(raw).hostname; } catch (e) { /* keep empty */ }
    return {
      type: 'url',
      label: 'URL',
      summary: raw,
      fields: host ? [{ label: 'Link', value: raw, mono: true }] : [],
      linkHost: host,
      form: { url: raw },
      actions: [
        { id: 'open', kind: 'link', label: 'Open link', url: raw },
        { id: 'copy-url', kind: 'copy', label: 'Copy URL', copy: raw }
      ]
    };
  }

  function parseText(raw) {
    return {
      type: 'text',
      label: 'TEXT',
      summary: raw.length > 80 ? raw.slice(0, 80) + '…' : raw,
      fields: [{ label: 'Content', value: raw }],
      form: { text: raw },
      actions: [
        { id: 'copy-text', kind: 'copy', label: 'Copy text', copy: raw }
      ]
    };
  }

  /**
   * Main entry: classify raw QR content into a structured result.
   * @param {string} raw
   * @returns {{type:string,label:string,summary:string,fields:Array,actions:Array,raw:string,linkHost?:string}}
   */
  function parse(raw) {
    var text = String(raw == null ? '' : raw).trim();
    var m;

    if (/^WIFI:/i.test(text)) return finalize(parseWifi(text), text);
    if (/^MECARD:/i.test(text)) return finalize(parseMecard(text), text);
    if (/^BEGIN:VCARD/i.test(text)) return finalize(parseVcard(text), text);
    if (/^BEGIN:VEVENT/i.test(text)) return finalize(parseEvent(text), text);

    if (/^geo:/i.test(text)) {
      m = /^geo:(-?[\d.]+),(-?[\d.]+)/i.exec(text);
      if (m) return finalize(parseGeo(text, m[1], m[2]), text);
    }
    if (/^GEO:/i.test(text)) {
      m = /^GEO:(-?[\d.]+),(-?[\d.]+)/i.exec(text);
      if (m) return finalize(parseGeo(text, m[1], m[2]), text);
    }

    if (/^mailto:/i.test(text)) {
      m = /^mailto:([^?]+)(?:\?(.*))?$/i.exec(text);
      if (m) {
        var params = {};
        (m[2] || '').split('&').forEach(function (kv) {
          var p = kv.split('=');
          if (p[0]) params[decodeURIComponent(p[0]).toLowerCase()] = decodeURIComponent((p[1] || '').replace(/\+/g, ' '));
        });
        return finalize(parseEmail(text, decodeURIComponent(m[1]), params.subject, params.body), text);
      }
    }
    if (/^MATMSG:/i.test(text)) {
      var mm = {};
      splitUnescaped(text.replace(/^MATMSG:/i, ''), ';').forEach(function (p) {
        var idx = p.indexOf(':');
        if (idx > 0) mm[p.slice(0, idx).toUpperCase()] = p.slice(idx + 1);
      });
      if (mm.TO) return finalize(parseEmail(text, mm.TO, mm.SUB, mm.BODY), text);
    }

    if (/^smsto:/i.test(text)) {
      m = /^smsto:([^:]*)(?::(.*))?$/i.exec(text);
      if (m) return finalize(parseSms(text, m[1], m[2] || ''), text);
    }
    if (/^sms:/i.test(text)) {
      m = /^sms:([^?]*)(?:\?(.*))?$/i.exec(text);
      if (m) {
        var body2 = '';
        (m[2] || '').split('&').forEach(function (kv) {
          var p = kv.split('=');
          if (p[0] && decodeURIComponent(p[0]).toLowerCase() === 'body') body2 = decodeURIComponent(p[1] || '');
        });
        return finalize(parseSms(text, m[1], body2), text);
      }
    }

    if (/^tel:/i.test(text)) return finalize(parsePhone(text, text.replace(/^tel:/i, '')), text);

    if (/^https?:\/\//i.test(text)) return finalize(parseUrl(text), text);

    // Heuristic: bare domain with path, e.g. "example.com/page"
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(text) && text.indexOf(' ') < 0 && text.indexOf('@') < 0) {
      return finalize(parseUrl('https://' + text), text);
    }

    return finalize(parseText(text), text);
  }

  function finalize(result, raw) {
    result.raw = raw;
    if (!result.actions) result.actions = [];
    result.actions.push({ id: 'copy-raw', kind: 'copy', label: 'Copy raw content', copy: raw });
    return result;
  }

  root.QRParse = {
    parse: parse,
    buildVcard: buildVcard,
    escapeField: escapeField,
    unescapeField: unescapeField
  };
})(typeof window !== 'undefined' ? window : globalThis);
