/**
 * generator.js — QR generation module (F1–F3).
 * Depends on: vendor/qr-code-styling.js (window.QRCodeStyling), js/parse.js (window.QRParse).
 * Exposes window.QRGenerator.
 */
(function (root) {
  'use strict';

  /* Byte-mode capacity per QR version 1–40, derived from the RS block table of
   * qrcode-generator (the same engine qr-code-styling uses) and cross-checked
   * against ISO/IEC 18004 published values (V1-L=17, V5-Q=60, V10-L=271,
   * V40-L=2953, V40-H=1273). Header bytes: 2 for V1–9, 3 for V10–40. */
  var BYTE_CAPACITY = {
    L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953],
    M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412, 450, 504, 560, 624, 666, 711, 779, 857, 911, 997, 1059, 1125, 1190, 1264, 1370, 1452, 1538, 1628, 1722, 1809, 1911, 1989, 2099, 2213, 2331],
    Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482, 509, 565, 611, 661, 715, 751, 805, 868, 908, 982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499, 1579, 1663],
    H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119, 137, 155, 177, 194, 220, 250, 280, 310, 338, 382, 403, 439, 461, 511, 535, 593, 625, 658, 698, 742, 790, 842, 898, 958, 983, 1051, 1093, 1139, 1219, 1273]
  };

  var ICONS = {
    url: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7V5h16v2M9 5v14M15 5v14M4 19h16"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>',
    email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
    sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    contact: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
    location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    event: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18M12 14v4M10 16h4"/></svg>'
  };

  var TYPES = [
    {
      id: 'url', label: 'URL',
      fields: [
        { name: 'url', label: 'Website URL', type: 'url', placeholder: 'https://example.com', required: true, hint: 'https:// is added automatically if missing' }
      ],
      encode: function (d) { return normalizeUrl(d.url); },
      emptyHint: 'Enter a URL'
    },
    {
      id: 'text', label: 'Text',
      fields: [
        { name: 'text', label: 'Text content', type: 'textarea', placeholder: 'Any text you want to encode…', required: true }
      ],
      encode: function (d) { return d.text.trim(); },
      emptyHint: 'Enter some text'
    },
    {
      id: 'wifi', label: 'Wi-Fi',
      fields: [
        { name: 'ssid', label: 'Network name (SSID)', type: 'text', placeholder: 'MyNetwork', required: true },
        { name: 'password', label: 'Password', type: 'text', placeholder: 'Network password', hint: 'Leave empty for open networks' },
        {
          name: 'security', label: 'Security', type: 'select',
          options: [{ v: 'WPA', l: 'WPA / WPA2 / WPA3' }, { v: 'WEP', l: 'WEP' }, { v: 'none', l: 'Open (no password)' }],
          value: 'WPA'
        },
        { name: 'hidden', label: 'Hidden network', type: 'checkbox' }
      ],
      encode: function (d) {
        if (!d.ssid) return '';
        var auth = d.security === 'none' ? 'nopass' : d.security;
        var out = 'WIFI:T:' + auth + ';S:' + QRParse.escapeField(d.ssid) + ';';
        if (auth !== 'nopass' && d.password) out += 'P:' + QRParse.escapeField(d.password) + ';';
        if (d.hidden) out += 'H:true;';
        return out + ';';
      },
      emptyHint: 'Enter the network name'
    },
    {
      id: 'email', label: 'Email',
      fields: [
        { name: 'to', label: 'To', type: 'email', placeholder: 'name@example.com', required: true },
        { name: 'subject', label: 'Subject', type: 'text', placeholder: 'Optional' },
        { name: 'body', label: 'Message', type: 'textarea', placeholder: 'Optional message body' }
      ],
      encode: function (d) {
        if (!d.to) return '';
        var url = 'mailto:' + d.to.trim();
        var qs = [];
        if (d.subject) qs.push('subject=' + encodeURIComponent(d.subject));
        if (d.body) qs.push('body=' + encodeURIComponent(d.body));
        return qs.length ? url + '?' + qs.join('&') : url;
      },
      emptyHint: 'Enter a recipient'
    },
    {
      id: 'sms', label: 'SMS',
      fields: [
        { name: 'number', label: 'Phone number', type: 'tel', placeholder: '+1 555 0100', required: true },
        { name: 'message', label: 'Message', type: 'textarea', placeholder: 'Optional pre-filled message' }
      ],
      encode: function (d) {
        if (!d.number) return '';
        return 'SMSTO:' + d.number.trim() + ':' + (d.message || '');
      },
      emptyHint: 'Enter a phone number'
    },
    {
      id: 'phone', label: 'Phone',
      fields: [
        { name: 'number', label: 'Phone number', type: 'tel', placeholder: '+1 555 0100', required: true }
      ],
      encode: function (d) { return d.number ? 'tel:' + d.number.trim() : ''; },
      emptyHint: 'Enter a phone number'
    },
    {
      id: 'contact', label: 'Contact',
      fields: [
        { name: 'name', label: 'Full name', type: 'text', placeholder: 'Jane Doe', required: true },
        { name: 'phone', label: 'Phone', type: 'tel', placeholder: '+1 555 0100' },
        { name: 'email', label: 'Email', type: 'email', placeholder: 'jane@example.com' },
        { name: 'org', label: 'Organization', type: 'text', placeholder: 'Acme Inc.' },
        { name: 'website', label: 'Website', type: 'url', placeholder: 'https://example.com' }
      ],
      encode: function (d) {
        if (!d.name) return '';
        return QRParse.buildVcard({ name: d.name, tel: d.phone, email: d.email, org: d.org, url: normalizeUrl(d.website) });
      },
      emptyHint: 'Enter a name'
    },
    {
      id: 'location', label: 'Location',
      fields: [
        { name: 'lat', label: 'Latitude', type: 'text', placeholder: '48.8584', required: true, hint: 'Decimal degrees, e.g. 48.8584' },
        { name: 'lng', label: 'Longitude', type: 'text', placeholder: '2.2945', required: true }
      ],
      encode: function (d) {
        if (!isNum(d.lat) || !isNum(d.lng)) return '';
        return 'geo:' + d.lat.trim() + ',' + d.lng.trim();
      },
      emptyHint: 'Enter coordinates'
    },
    {
      id: 'event', label: 'Event',
      fields: [
        { name: 'title', label: 'Event title', type: 'text', placeholder: 'Team meeting', required: true },
        { name: 'location', label: 'Location', type: 'text', placeholder: 'Conference room A' },
        { name: 'startDate', label: 'Start date', type: 'date', required: true, half: true },
        { name: 'startTime', label: 'Start time', type: 'time', half: true },
        { name: 'endDate', label: 'End date', type: 'date', half: true },
        { name: 'endTime', label: 'End time', type: 'time', half: true },
        { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Optional details' }
      ],
      encode: function (d) {
        if (!d.title || !d.startDate) return '';
        function fmt(date, time) {
          if (!date) return '';
          return date.replace(/-/g, '') + (time ? 'T' + time.replace(':', '') + '00' : '');
        }
        var lines = ['BEGIN:VEVENT', 'SUMMARY:' + d.title];
        var start = fmt(d.startDate, d.startTime);
        if (start) lines.push('DTSTART:' + start);
        var end = fmt(d.endDate, d.endTime);
        if (end) lines.push('DTEND:' + end);
        if (d.location) lines.push('LOCATION:' + d.location);
        if (d.description) lines.push('DESCRIPTION:' + d.description.replace(/\n/g, '\\n'));
        lines.push('END:VEVENT');
        return lines.join('\n');
      },
      emptyHint: 'Enter a title and start date'
    }
  ];

  /* ---------------- state ---------------- */
  var currentTypeId = 'url';
  var formData = {};
  var qr = null;               // preview instance
  var logoDataUrl = null;
  var renderTimer = null;

  /* ---------------- DOM ---------------- */
  var el = {};

  function $(id) { return document.getElementById(id); }

  function cacheDom() {
    ['type-grid', 'dynamic-fields', 'qr-preview', 'capacity-hint',
      'fg-color', 'fg-hex', 'bg-color', 'bg-hex',
      'gradient-toggle', 'gradient-opts', 'gradient-color2', 'gradient-rotation', 'gradient-rotation-val',
      'dot-style', 'corner-style', 'ecc-level', 'qr-size', 'qr-size-val',
      'logo-input', 'logo-clear', 'logo-size-field', 'logo-size', 'logo-size-val',
      'contrast-alert', 'logo-alert', 'preset-row',
      'btn-download-png', 'btn-download-1024', 'btn-download-2048', 'btn-download-svg', 'btn-copy-png',
      'toast'
    ].forEach(function (id) { el[id] = $(id); });
  }

  /* ---------------- helpers ---------------- */
  function normalizeUrl(v) {
    v = (v || '').trim();
    if (!v) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) return 'https://' + v;
    return v;
  }

  function isNum(v) {
    return v != null && v !== '' && !isNaN(Number(v)) && Math.abs(Number(v)) <= 180;
  }

  function utf8Len(s) {
    if (window.TextEncoder) return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
  }

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.hidden = true; }, 2400);
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function relLuminance(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return null;
    var lin = rgb.map(function (c) {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }

  function contrastRatio(hexA, hexB) {
    var la = relLuminance(hexA), lb = relLuminance(hexB);
    if (la == null || lb == null) return 21;
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  function currentType() {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === currentTypeId) return TYPES[i];
    return TYPES[0];
  }

  function payload() {
    return currentType().encode(formData);
  }

  /* ---------------- form rendering ---------------- */
  function renderTypeGrid() {
    el['type-grid'].innerHTML = '';
    TYPES.forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'type-chip' + (t.id === currentTypeId ? ' active' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', t.id === currentTypeId ? 'true' : 'false');
      btn.dataset.type = t.id;
      btn.innerHTML = ICONS[t.id] + '<span>' + t.label + '</span>';
      btn.addEventListener('click', function () { selectType(t.id); });
      el['type-grid'].appendChild(btn);
    });
  }

  function selectType(id) {
    currentTypeId = id;
    formData = {};
    var chips = el['type-grid'].querySelectorAll('.type-chip');
    chips.forEach(function (c) {
      var active = c.dataset.type === id;
      c.classList.toggle('active', active);
      c.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    renderFields();
    scheduleRender();
  }

  function renderFields() {
    var t = currentType();
    var wrap = el['dynamic-fields'];
    wrap.innerHTML = '';
    t.fields.forEach(function (f) {
      var field = document.createElement('div');
      field.className = 'field' + (f.half ? ' field-half' : '');
      var id = 'f-' + f.name;

      if (f.type === 'checkbox') {
        field.innerHTML =
          '<label class="switch-label" for="' + id + '">' +
          '<input type="checkbox" id="' + id + '">' +
          '<span>' + f.label + '</span></label>';
      } else if (f.type === 'select') {
        var opts = f.options.map(function (o) {
          return '<option value="' + o.v + '"' + (f.value === o.v ? ' selected' : '') + '>' + o.l + '</option>';
        }).join('');
        field.innerHTML =
          '<label for="' + id + '">' + f.label + '</label>' +
          '<select id="' + id + '">' + opts + '</select>';
      } else if (f.type === 'textarea') {
        field.innerHTML =
          '<label for="' + id + '">' + f.label + '</label>' +
          '<textarea id="' + id + '" placeholder="' + (f.placeholder || '') + '"></textarea>';
      } else {
        field.innerHTML =
          '<label for="' + id + '">' + f.label + '</label>' +
          '<input type="' + f.type + '" id="' + id + '" placeholder="' + (f.placeholder || '') + '">' +
          (f.hint ? '<p class="hint">' + f.hint + '</p>' : '');
      }
      wrap.appendChild(field);

      var input = $(id);
      input.addEventListener('input', function () {
        formData[f.name] = f.type === 'checkbox' ? input.checked : input.value;
        scheduleRender();
      });
      input.addEventListener('change', function () {
        formData[f.name] = f.type === 'checkbox' ? input.checked : input.value;
        scheduleRender();
      });
      formData[f.name] = f.type === 'checkbox' ? false : (f.value || '');
    });
  }

  /* ---------------- design options ---------------- */
  function designState() {
    return {
      fg: el['fg-color'].value,
      bg: el['bg-color'].value,
      gradient: el['gradient-toggle'].checked,
      gradColor2: el['gradient-color2'].value,
      gradRotation: parseInt(el['gradient-rotation'].value, 10),
      dotStyle: el['dot-style'].value,
      cornerStyle: el['corner-style'].value,
      ecc: el['ecc-level'].value,
      size: parseInt(el['qr-size'].value, 10),
      logoSize: parseInt(el['logo-size'].value, 10)
    };
  }

  function buildOptions(data, px, type) {
    var d = designState();
    var gradient = d.gradient ? {
      type: 'linear',
      rotation: d.gradRotation * Math.PI / 180,
      colorStops: [{ offset: 0, color: d.fg }, { offset: 1, color: d.gradColor2 }]
    } : undefined;

    var opts = {
      type: type || 'canvas',
      width: px || d.size,
      height: px || d.size,
      data: data,
      margin: 20,
      qrOptions: { errorCorrectionLevel: d.ecc },
      dotsOptions: gradient ? { type: d.dotStyle, gradient: gradient } : { type: d.dotStyle, color: d.fg },
      cornersSquareOptions: gradient
        ? { type: d.cornerStyle, gradient: gradient }
        : { type: d.cornerStyle, color: d.fg },
      cornersDotOptions: { type: 'dot', color: d.gradient ? d.gradColor2 : d.fg },
      backgroundOptions: { color: d.bg }
    };

    if (logoDataUrl) {
      opts.image = logoDataUrl;
      opts.imageOptions = { crossOrigin: 'anonymous', hideBackgroundDots: true, imageSize: d.logoSize / 100, margin: 4 };
    }
    return opts;
  }

  /* ---------------- rendering ---------------- */
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 250);
  }

  function render() {
    var data = payload();
    var d = designState();
    var preview = el['qr-preview'];

    if (!data) {
      preview.innerHTML = '<p class="capacity-hint" style="margin:0">' + currentType().emptyHint + '</p>';
      el['capacity-hint'].hidden = true;
      updateAlerts('', d);
      qr = null;
      return;
    }

    var opts = buildOptions(data, d.size);
    if (!qr) {
      // QRCodeStyling.append() does not clear the container — drop any empty-state node first.
      preview.innerHTML = '';
      qr = new QRCodeStyling(opts);
      qr.append(preview);
    } else {
      qr.update(opts);
    }
    updateCapacityHint(data);
    updateAlerts(data, d);
  }

  function updateCapacityHint(data) {
    var d = designState();
    var len = utf8Len(data);
    var table = BYTE_CAPACITY[d.ecc];
    var version = -1;
    for (var v = 0; v < table.length; v++) {
      if (len <= table[v]) { version = v + 1; break; }
    }
    var hint = el['capacity-hint'];
    if (version < 0) {
      hint.hidden = false;
      hint.textContent = 'Content is ' + len + ' bytes — too long for any QR code (max ' + table[table.length - 1] + ' at this error-correction level). Shorten it or raise the level to Low.';
      hint.style.color = 'var(--danger)';
      return;
    }
    hint.hidden = false;
    hint.style.color = '';
    var pct = Math.round(len / table[version - 1] * 100);
    hint.textContent = 'Version ' + version + ' · ' + len + ' / ' + table[version - 1] + ' bytes (' + pct + '% used) · ' + modulesForVersion(version) + ' × ' + modulesForVersion(version) + ' modules';
  }

  function modulesForVersion(version) {
    return version * 4 + 17;
  }

  function updateAlerts(data, d) {
    var fgL = relLuminance(d.fg);
    var bgL = relLuminance(d.bg);
    var minContrast = contrastRatio(d.fg, d.bg);
    if (d.gradient) {
      minContrast = Math.min(minContrast, contrastRatio(d.gradColor2, d.bg));
    }
    el['contrast-alert'].hidden = minContrast >= 3;

    var coverage = logoDataUrl ? Math.pow(d.logoSize / 100, 2) : 0;
    el['logo-alert'].hidden = coverage <= 0.20;
  }

  /* ---------------- export ---------------- */
  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function timestamp() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  async function exportPng(px) {
    var data = payload();
    if (!data) { toast('Nothing to export — fill in the required fields'); return; }
    try {
      var tmp = new QRCodeStyling(buildOptions(data, px, 'canvas'));
      var blob = await tmp.getRawData('png');
      saveBlob(blob, 'qr-' + currentTypeId + '-' + (px || '') + 'px-' + timestamp() + '.png');
      toast('PNG downloaded (' + (px || designState().size) + 'px)');
    } catch (e) {
      console.error(e);
      toast('Export failed: ' + (e && e.message ? e.message : e));
    }
  }

  async function exportSvg() {
    var data = payload();
    if (!data) { toast('Nothing to export — fill in the required fields'); return; }
    try {
      var tmp = new QRCodeStyling(buildOptions(data, designState().size, 'svg'));
      var blob = await tmp.getRawData('svg');
      saveBlob(blob, 'qr-' + currentTypeId + '-' + timestamp() + '.svg');
      toast('SVG downloaded (vector, print-ready)');
    } catch (e) {
      console.error(e);
      toast('Export failed: ' + (e && e.message ? e.message : e));
    }
  }

  async function copyPng() {
    var data = payload();
    if (!data) { toast('Nothing to copy — fill in the required fields'); return; }
    try {
      var tmp = new QRCodeStyling(buildOptions(data, designState().size, 'canvas'));
      var blob = await tmp.getRawData('png');
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Image copied to clipboard');
    } catch (e) {
      console.warn(e);
      toast('Copy not supported here — use Download PNG');
    }
  }

  /* ---------------- design UI binding ---------------- */
  function bindColorPair(colorId, hexId) {
    var color = $(colorId), hex = $(hexId);
    function fromColor() { hex.value = color.value.toLowerCase(); scheduleRender(); }
    function fromHex() {
      var v = hex.value.trim();
      if (/^#?[0-9a-f]{6}$/i.test(v)) {
        color.value = v[0] === '#' ? v.toLowerCase() : '#' + v.toLowerCase();
        scheduleRender();
      }
    }
    color.addEventListener('input', fromColor);
    hex.addEventListener('change', fromHex);
    hex.addEventListener('blur', fromHex);
  }

  function bindDesignControls() {
    bindColorPair('fg-color', 'fg-hex');
    bindColorPair('bg-color', 'bg-hex');

    el['gradient-toggle'].addEventListener('change', function () {
      el['gradient-opts'].hidden = !el['gradient-toggle'].checked;
      scheduleRender();
    });
    el['gradient-color2'].addEventListener('input', scheduleRender);
    el['gradient-rotation'].addEventListener('input', function () {
      el['gradient-rotation-val'].textContent = el['gradient-rotation'].value + '°';
      scheduleRender();
    });

    ['dot-style', 'corner-style', 'ecc-level'].forEach(function (id) {
      el[id].addEventListener('change', scheduleRender);
    });

    el['qr-size'].addEventListener('input', function () {
      el['qr-size-val'].textContent = el['qr-size'].value + 'px';
      scheduleRender();
    });

    el['logo-input'].addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) { toast('Logo must be under 2 MB'); el['logo-input'].value = ''; return; }
      var reader = new FileReader();
      reader.onload = function () {
        logoDataUrl = reader.result;
        el['logo-clear'].hidden = false;
        el['logo-size-field'].hidden = false;
        // When a logo is present, suggest High error correction (requirement F1.4).
        if (el['ecc-level'].value !== 'H') {
          el['ecc-level'].value = 'H';
          toast('Error correction raised to High (30%) — recommended with a logo');
        }
        render();
      };
      reader.readAsDataURL(file);
    });

    el['logo-clear'].addEventListener('click', function () {
      logoDataUrl = null;
      el['logo-input'].value = '';
      el['logo-clear'].hidden = true;
      el['logo-size-field'].hidden = true;
      render();
    });

    el['logo-size'].addEventListener('input', function () {
      el['logo-size-val'].textContent = el['logo-size'].value + '%';
      scheduleRender();
    });

    var PRESETS = {
      classic: { fg: '#111827', bg: '#ffffff', gradient: false, dot: 'square', corner: 'square' },
      ink: { fg: '#1e3a5f', bg: '#f8fafc', gradient: true, gradColor2: '#3b82f6', dot: 'dots', corner: 'dot' },
      ocean: { fg: '#0e7490', bg: '#ecfeff', gradient: true, gradColor2: '#22d3ee', dot: 'rounded', corner: 'extra-rounded' },
      sunset: { fg: '#7c2d12', bg: '#fff7ed', gradient: true, gradColor2: '#f97316', dot: 'rounded', corner: 'dot' }
    };
    el['preset-row'].addEventListener('click', function (e) {
      var btn = e.target.closest('.preset-btn');
      if (!btn) return;
      var p = PRESETS[btn.dataset.preset];
      if (!p) return;
      el['fg-color'].value = p.fg; el['fg-hex'].value = p.fg;
      el['bg-color'].value = p.bg; el['bg-hex'].value = p.bg;
      el['gradient-toggle'].checked = p.gradient;
      el['gradient-opts'].hidden = !p.gradient;
      if (p.gradColor2) el['gradient-color2'].value = p.gradColor2;
      el['dot-style'].value = p.dot;
      el['corner-style'].value = p.corner;
      scheduleRender();
    });

    el['btn-download-png'].addEventListener('click', function () { exportPng(null); });
    el['btn-download-1024'].addEventListener('click', function () { exportPng(1024); });
    el['btn-download-2048'].addEventListener('click', function () { exportPng(2048); });
    el['btn-download-svg'].addEventListener('click', exportSvg);
    el['btn-copy-png'].addEventListener('click', copyPng);
  }

  /* ---------------- round-trip from scanner ---------------- */
  function fillFromParsed(parsed) {
    var t = currentType();
    var form = parsed.form || {};
    var target = null;
    TYPES.forEach(function (x) { if (x.id === parsed.type) target = x; });
    if (!target && parsed.type === 'contact') target = { id: 'contact' };
    if (!target) target = { id: 'text' };

    selectType(target.id);
    Object.keys(form).forEach(function (k) {
      var input = $('f-' + k);
      if (!input) return;
      if (input.type === 'checkbox') input.checked = !!form[k];
      else input.value = form[k];
      formData[k] = input.type === 'checkbox' ? input.checked : input.value;
    });
    render();
    return target.id;
  }

  /* ---------------- init ---------------- */
  function init() {
    cacheDom();
    renderTypeGrid();
    renderFields();
    bindDesignControls();
    render();
  }

  root.QRGenerator = {
    init: init,
    fillFromParsed: fillFromParsed,
    currentPayload: payload
  };
})(window);
