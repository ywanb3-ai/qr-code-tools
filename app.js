/**
 * app.js — entry point: theme, tab routing, module bootstrap.
 */
(function () {
  'use strict';

  var THEME_KEY = 'qr-studio-theme';

  function applyTheme(theme) {
    if (theme) {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function effectiveTheme() {
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit) return explicit;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
    applyTheme(saved);

    var btn = document.getElementById('theme-toggle');
    btn.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
      btn.setAttribute('aria-label', next === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));
    var panels = {
      generate: document.getElementById('panel-generate'),
      scan: document.getElementById('panel-scan')
    };

    function switchTab(name) {
      if (!panels[name]) name = 'generate';
      tabs.forEach(function (t) {
        var active = t.dataset.tab === name;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      Object.keys(panels).forEach(function (k) {
        panels[k].hidden = k !== name;
      });
      // Leaving the scan tab releases the camera (battery + privacy).
      if (name !== 'scan' && window.QRScanner) window.QRScanner.stopCamera();
      if (history.replaceState) history.replaceState(null, '', '#' + name);
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function () { switchTab(t.dataset.tab); });
    });

    var initial = (location.hash || '').replace('#', '') === 'scan' ? 'scan' : 'generate';
    switchTab(initial);

    window.addEventListener('hashchange', function () {
      switchTab((location.hash || '').replace('#', '') || 'generate');
    });

    return { switchTab: switchTab };
  }

  function boot() {
    initTheme();
    // Modules first: tab switching can trigger scanner cleanup before its DOM cache exists.
    if (window.QRGenerator) window.QRGenerator.init();
    if (window.QRScanner) window.QRScanner.init();
    window.QRApp = initTabs();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
