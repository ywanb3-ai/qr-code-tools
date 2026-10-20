/**
 * scanner.js — QR scanning module (F4–F5).
 * Depends on: vendor/jsQR.js (window.jsQR), js/parse.js (window.QRParse).
 * Exposes window.QRScanner.
 */
(function (root) {
  'use strict';

  var HISTORY_KEY = 'qr-studio-history-v1';
  var HISTORY_MAX = 100;
  var DEDUPE_MS = 3000;

  /* ---------------- state ---------------- */
  var stream = null;
  var scanning = false;
  var rafId = null;
  var torchOn = false;
  var videoTrack = null;
  var lastData = null;
  var lastTime = 0;
  var emptyFrames = 0;          // frames without a result; used to escalate inversion strategy
  var history = [];
  var el = {};

  function $(id) { return document.getElementById(id); }

  function cacheDom() {
    ['camera-video', 'scan-overlay', 'camera-placeholder',
      'btn-camera-start', 'btn-camera-stop', 'camera-select', 'btn-torch', 'camera-hint',
      'drop-zone', 'image-input',
      'result-empty', 'result-body', 'result-badge', 'result-time', 'result-content', 'result-actions',
      'history-list', 'btn-history-clear', 'toast'
    ].forEach(function (id) { el[id] = $(id); });
  }

  function toast(msg) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.toast.hidden = true; }, 2400);
  }

  /* ---------------- camera ---------------- */
  function cameraSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function setCameraUi(active) {
    if (el['btn-camera-start']) el['btn-camera-start'].hidden = active;
    if (el['btn-camera-stop']) el['btn-camera-stop'].hidden = !active;
    if (el['camera-placeholder']) el['camera-placeholder'].hidden = active;
    if (el['scan-overlay']) el['scan-overlay'].hidden = !active;
  }

  function showHint(msg) {
    if (!msg) { el['camera-hint'].hidden = true; return; }
    el['camera-hint'].hidden = false;
    el['camera-hint'].textContent = msg;
  }

  async function refreshDevices() {
    try {
      var devices = await navigator.mediaDevices.enumerateDevices();
      var cams = devices.filter(function (d) { return d.kind === 'videoinput'; });
      var sel = el['camera-select'];
      sel.innerHTML = '';
      cams.forEach(function (d, i) {
        var opt = document.createElement('option');
        opt.value = d.deviceId;
        opt.textContent = d.label || ('Camera ' + (i + 1));
        sel.appendChild(opt);
      });
      sel.hidden = cams.length < 2;
      if (videoTrack && cams.length === 1) sel.value = cams[0].deviceId;
    } catch (e) { /* device labels are best-effort */ }
  }

  async function startCamera(deviceId) {
    if (!cameraSupported()) {
      showHint('Camera needs a secure context (HTTPS or localhost). On some browsers file:// pages cannot access it — image scanning still works.');
      return;
    }
    stopCamera();
    var constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: 'environment' }
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      var msg = err && err.name === 'NotAllowedError'
        ? 'Camera permission denied. Allow it in your browser settings, or use image scanning below.'
        : 'Could not start the camera: ' + (err && err.message ? err.message : err);
      showHint(msg);
      return;
    }
    var video = el['camera-video'];
    video.srcObject = stream;
    try { await video.play(); } catch (e) { /* autoplay of muted stream should succeed */ }
    videoTrack = stream.getVideoTracks()[0];
    await refreshDevices();

    // Torch capability (best-effort; Chrome on Android)
    var torchOk = false;
    try {
      var caps = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
      torchOk = 'torch' in caps;
    } catch (e) { /* not supported */ }
    el['btn-torch'].hidden = !torchOk;

    showHint('');
    setCameraUi(true);
    scanning = true;
    emptyFrames = 0;
    rafId = requestAnimationFrame(tick);
  }

  function stopCamera() {
    scanning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) {
      stream.getTracks().forEach(function (t) { t.stop(); });
      stream = null;
    }
    videoTrack = null;
    torchOn = false;
    if (el['btn-torch']) el['btn-torch'].classList.remove('on');
    var video = el['camera-video'];
    if (video) video.srcObject = null;
    setCameraUi(false);
  }

  async function toggleTorch() {
    if (!videoTrack) return;
    try {
      torchOn = !torchOn;
      await videoTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
      el['btn-torch'].classList.toggle('on', torchOn);
    } catch (e) {
      torchOn = false;
      toast('Flashlight not available on this device');
    }
  }

  /* ---------------- decode loop ---------------- */
  var decodeCanvas = document.createElement('canvas');
  var decodeCtx = decodeCanvas.getContext('2d', { willReadFrequently: true });

  function tick() {
    if (!scanning) return;
    var video = el['camera-video'];
    if (video.readyState >= 2 && video.videoWidth > 0) {
      var w = video.videoWidth, h = video.videoHeight;
      var scale = Math.min(1, 640 / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      if (decodeCanvas.width !== cw || decodeCanvas.height !== ch) {
        decodeCanvas.width = cw;
        decodeCanvas.height = ch;
      }
      decodeCtx.drawImage(video, 0, 0, cw, ch);
      var frame = decodeCtx.getImageData(0, 0, cw, ch);
      // Start fast (no inversion); if nothing found for a while, retry with
      // inverted-image support for low-contrast / light-on-dark codes.
      var mode = emptyFrames > 30 ? 'attemptBoth' : 'dontInvert';
      var result = null;
      try {
        result = root.jsQR(frame.data, cw, ch, { inversionAttempts: mode });
      } catch (e) { /* decode errors are transient */ }
      if (result && result.data) {
        emptyFrames = 0;
        onResult(result.data, 'camera');
      } else {
        emptyFrames++;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  /* ---------------- image scanning ---------------- */
  function scanImageFile(file) {
    if (!file || !/^image\//.test(file.type)) { toast('Please choose an image file'); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      var w = img.naturalWidth, h = img.naturalHeight;
      var scale = Math.min(1, 1280 / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      decodeCanvas.width = cw;
      decodeCanvas.height = ch;
      decodeCtx.drawImage(img, 0, 0, cw, ch);
      var frame = decodeCtx.getImageData(0, 0, cw, ch);
      var result = null;
      try {
        result = root.jsQR(frame.data, cw, ch, { inversionAttempts: 'attemptBoth' });
      } catch (e) { /* fall through to not-found */ }
      if (result && result.data) {
        onResult(result.data, 'image');
      } else {
        toast('No QR code found in this image');
      }
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      toast('Could not read that image');
    };
    img.src = url;
  }

  function bindImageInputs() {
    var dz = el['drop-zone'];
    dz.addEventListener('click', function () { el['image-input'].click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el['image-input'].click(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) scanImageFile(f);
    });
    el['image-input'].addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) scanImageFile(f);
      e.target.value = '';
    });

    // Paste from clipboard anywhere in the scan panel
    document.addEventListener('paste', function (e) {
      if (document.getElementById('panel-scan').hidden) return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) { scanImageFile(f); e.preventDefault(); }
          return;
        }
      }
    });
  }

  /* ---------------- result handling ---------------- */
  function onResult(raw, source) {
    var now = Date.now();
    if (raw === lastData && now - lastTime < DEDUPE_MS) return;
    lastData = raw;
    lastTime = now;

    if (source === 'camera') {
      if (navigator.vibrate) { try { navigator.vibrate(60); } catch (e) { /* ignore */ } }
      beep();
      flashReticle();
    }

    var parsed = QRParse.parse(raw);
    parsed.ts = now;
    showResult(parsed);
    addToHistory(parsed);
  }

  function flashReticle() {
    var reticle = el['scan-overlay'].querySelector('.scan-reticle');
    if (!reticle) return;
    reticle.style.borderColor = '#4ade80';
    reticle.style.boxShadow = '0 0 0 9999px rgb(0 0 0 / 0.35), 0 0 18px #4ade80';
    setTimeout(function () {
      reticle.style.borderColor = '';
      reticle.style.boxShadow = '';
    }, 350);
  }

  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1180;
      gain.gain.setValueAtTime(0.16, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.11);
      setTimeout(function () { ctx.close(); }, 400);
    } catch (e) { /* audio is optional feedback */ }
  }

  function showResult(parsed) {
    el['result-empty'].hidden = true;
    el['result-body'].hidden = false;

    el['result-badge'].textContent = parsed.label;
    el['result-time'].textContent = formatTime(parsed.ts);

    var content = el['result-content'];
    content.innerHTML = '';
    if (parsed.fields && parsed.fields.length) {
      var dl = document.createElement('dl');
      dl.style.margin = '0';
      parsed.fields.forEach(function (f) {
        var row = document.createElement('div');
        row.className = 'kv';
        var dt = document.createElement('dt');
        dt.textContent = f.label;
        var dd = document.createElement('dd');
        if (f.mono) dd.className = 'mono';
        dd.textContent = f.value;
        row.appendChild(dt);
        row.appendChild(dd);
        dl.appendChild(row);
      });
      content.appendChild(dl);
    } else {
      content.textContent = parsed.summary || parsed.raw;
    }

    if (parsed.linkHost) {
      var notice = document.createElement('p');
      notice.className = 'link-notice';
      notice.innerHTML = 'This link points to <code></code>. Only open links from sources you trust.';
      notice.querySelector('code').textContent = parsed.linkHost;
      content.appendChild(notice);
    }

    var actions = el['result-actions'];
    actions.innerHTML = '';
    (parsed.actions || []).forEach(function (a) {
      var btn;
      if (a.kind === 'link') {
        btn = document.createElement('a');
        btn.className = 'btn';
        btn.href = a.url;
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
      } else {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
      }
      btn.textContent = a.label;
      btn.addEventListener('click', function () {
        if (a.kind === 'copy') {
          copyText(a.copy, a.label + ' copied');
        } else if (a.kind === 'download') {
          saveText(a.download.filename, a.download.content);
          toast('Saved ' + a.download.filename);
        }
      });
      actions.appendChild(btn);
    });

    // Round-trip: send this content back to the generator (F5.5)
    var reuse = document.createElement('button');
    reuse.type = 'button';
    reuse.className = 'btn btn-primary';
    reuse.textContent = 'Edit as new QR code';
    reuse.addEventListener('click', function () {
      var targetType = QRGenerator.fillFromParsed(parsed);
      if (window.QRApp && window.QRApp.switchTab) window.QRApp.switchTab('generate');
      toast('Loaded into the ' + targetType + ' generator');
    });
    actions.appendChild(reuse);
  }

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okMsg || 'Copied');
      }).catch(function () {
        fallbackCopy(text, okMsg);
      });
    } else {
      fallbackCopy(text, okMsg);
    }
  }

  function fallbackCopy(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      toast(okMsg || 'Copied');
    } catch (e) {
      toast('Copy failed — select the text manually');
    }
    document.body.removeChild(ta);
  }

  function saveText(filename, content) {
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function formatTime(ts) {
    var d = new Date(ts || Date.now());
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- history ---------------- */
  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      history = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(history)) history = [];
    } catch (e) {
      history = [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (e) { /* private mode: history stays in memory */ }
  }

  function addToHistory(parsed) {
    // de-duplicate identical consecutive entries
    if (history.length && history[0].raw === parsed.raw) {
      history[0].ts = parsed.ts;
    } else {
      history.unshift({ raw: parsed.raw, type: parsed.type, label: parsed.label, summary: parsed.summary, ts: parsed.ts });
      if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
    }
    saveHistory();
    renderHistory();
  }

  function renderHistory() {
    var list = el['history-list'];
    list.innerHTML = '';
    el['btn-history-clear'].hidden = history.length === 0;
    history.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'history-item';

      var badge = document.createElement('span');
      badge.className = 'h-type';
      badge.textContent = item.label;

      var text = document.createElement('button');
      text.type = 'button';
      text.className = 'h-text';
      text.textContent = item.summary || item.raw;
      text.title = 'Show this result';
      text.addEventListener('click', function () {
        var parsed = QRParse.parse(item.raw);
        parsed.ts = item.ts;
        showResult(parsed);
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'h-del';
      del.textContent = '×';
      del.title = 'Remove from history';
      del.setAttribute('aria-label', 'Remove from history');
      del.addEventListener('click', function () {
        history = history.filter(function (x) { return x !== item; });
        saveHistory();
        renderHistory();
      });

      li.appendChild(badge);
      li.appendChild(text);
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  /* ---------------- init ---------------- */
  function init() {
    cacheDom();
    loadHistory();
    renderHistory();
    bindImageInputs();

    el['btn-camera-start'].addEventListener('click', function () { startCamera(null); });
    el['btn-camera-stop'].addEventListener('click', stopCamera);
    el['btn-torch'].addEventListener('click', toggleTorch);
    el['camera-select'].addEventListener('change', function (e) {
      if (e.target.value) startCamera(e.target.value);
    });

    el['btn-history-clear'].addEventListener('click', function () {
      history = [];
      saveHistory();
      renderHistory();
      toast('History cleared');
    });

    if (!cameraSupported()) {
      showHint('This browser or context does not expose camera APIs (file:// pages are restricted on some browsers). Image scanning works everywhere.');
      el['btn-camera-start'].disabled = true;
    }

    // Release the camera if the tab is hidden for a long time
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && scanning) stopCamera();
    });
  }

  root.QRScanner = {
    init: init,
    stopCamera: stopCamera
  };
})(window);
