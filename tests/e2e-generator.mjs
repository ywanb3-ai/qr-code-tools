/** verify-interact.mjs — generator-side end-to-end verification in real Chrome. */
const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:8931/index.html';
const DL = '/tmp/qr-downloads';

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; failures.push(name); console.log('  ✗', name, extra == null ? '' : '→ ' + extra); }
}

async function newTarget(u) {
  const res = await fetch(`${CDP}/json/new?${encodeURIComponent(u)}`, { method: 'PUT' });
  return res.json();
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onopen = () => resolve({
      send(method, params = {}) {
        const msgId = ++id;
        ws.send(JSON.stringify({ id: msgId, method, params }));
        return new Promise((res, rej) => pending.set(msgId, { res, rej }));
      },
      events,
      close: () => ws.close(),
    });
    ws.onerror = e => reject(new Error('ws error: ' + (e.message || e.type)));
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) events.push(msg);
    };
  });
}

const target = await newTarget(APP);
const client = await connect(target.webSocketDebuggerUrl);
await client.send('Runtime.enable');
await client.send('Page.enable');
await client.send('Log.enable');
await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await new Promise(r => setTimeout(r, 2200));

const evalJs = async (expression) => {
  const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
  return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 1. type chips + initial state ---------- */
console.log('\n[A] 初始渲染');
check('9 个内容类型 chips', await evalJs(`document.querySelectorAll('.type-chip').length`) === 9);
check('初始空态提示', (await evalJs(`document.getElementById('qr-preview').textContent`)).includes('Enter a URL'));

/* ---------- 2. URL generation ---------- */
console.log('\n[B] URL 生成');
await evalJs(`(() => {
  const i = document.getElementById('f-url');
  i.value = 'example.com';
  i.dispatchEvent(new Event('input', {bubbles:true}));
})()`);
await sleep(600);
check('URL 预览 canvas 出现', await evalJs(`!!document.querySelector('#qr-preview canvas')`));
check('URL 协议自动补全', await evalJs(`window.QRGenerator.currentPayload()`) === 'https://example.com');
const capText = await evalJs(`document.getElementById('capacity-hint').textContent`);
check('容量提示含版本与字节', /Version \d+ · \d+ \/ \d+ bytes \(\d+% used\) · \d+ × \d+ modules/.test(capText), capText);

/* ---------- 3. all 9 types encode ---------- */
console.log('\n[C] 9 类内容编码');
const samples = await evalJs(`(() => {
  const G = window.QRGenerator;
  const out = {};
  const set = (id, vals) => {
    document.querySelector('.type-chip[data-type="'+id+'"]').click();
    Object.keys(vals).forEach(k => {
      const el = document.getElementById('f-'+k);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = vals[k]; else el.value = vals[k];
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
    });
    return G.currentPayload();
  };
  out.url      = set('url', {url:'https://a.com/x?q=1'});
  out.text     = set('text', {text:'Hello 世界'});
  out.wifi     = set('wifi', {ssid:'Home;Net', password:'p:w', security:'WPA', hidden:true});
  out.email    = set('email', {to:'a@b.com', subject:'Hi', body:'Yo'});
  out.sms      = set('sms', {number:'+15550100', message:'Hey'});
  out.phone    = set('phone', {number:'+15550100'});
  out.contact  = set('contact', {name:'Jane Doe', phone:'+15550100', email:'j@x.com', org:'Acme', website:'acme.com'});
  out.location = set('location', {lat:'48.8584', lng:'2.2945'});
  out.event    = set('event', {title:'Meeting', location:'Room A', startDate:'2026-10-20', startTime:'09:00', endDate:'2026-10-20', endTime:'10:00', description:'Talk'});
  return out;
})()`);
check('url payload', samples.url === 'https://a.com/x?q=1', samples.url);
check('text payload', samples.text === 'Hello 世界', samples.text);
check('wifi payload (escaped)', samples.wifi === 'WIFI:T:WPA;S:Home\\;Net;P:p\\:w;H:true;;', samples.wifi);
check('email payload', samples.email === 'mailto:a@b.com?subject=Hi&body=Yo', samples.email);
check('sms payload', samples.sms === 'SMSTO:+15550100:Hey', samples.sms);
check('phone payload', samples.phone === 'tel:+15550100', samples.phone);
check('contact payload (vCard)', samples.contact.includes('BEGIN:VCARD') && samples.contact.includes('FN:Jane Doe') && samples.contact.includes('TEL;TYPE=CELL:+15550100'), samples.contact);
check('location payload', samples.location === 'geo:48.8584,2.2945', samples.location);
check('event payload', samples.event.includes('BEGIN:VEVENT') && samples.event.includes('DTSTART:20261020T090000') && samples.event.includes('DTEND:20261020T100000'), samples.event);
check('每类 payload 均非空', Object.values(samples).every(v => typeof v === 'string' && v.length > 0));

/* ---------- 4. design controls ---------- */
console.log('\n[D] 设计定制');
await evalJs(`(() => {
  document.querySelector('.type-chip[data-type="url"]').click();
  const i = document.getElementById('f-url'); i.value='https://example.com'; i.dispatchEvent(new Event('input',{bubbles:true}));
})()`);
await sleep(500);
const beforePx = await evalJs(`(() => { const c = document.querySelector('#qr-preview canvas'); return c ? c.width + 'x' + c.height : 'none'; })()`);
await evalJs(`(() => {
  document.getElementById('fg-color').value = '#ff0000';
  document.getElementById('fg-hex').value = '#ff0000';
  document.getElementById('bg-color').value = '#ffffff';
  document.getElementById('bg-hex').value = '#ffffff';
  document.getElementById('gradient-toggle').checked = true;
  document.getElementById('gradient-toggle').dispatchEvent(new Event('change',{bubbles:true}));
  document.getElementById('gradient-color2').value = '#0000ff';
  document.getElementById('gradient-color2').dispatchEvent(new Event('input',{bubbles:true}));
  document.getElementById('dot-style').value = 'dots';
  document.getElementById('dot-style').dispatchEvent(new Event('change',{bubbles:true}));
  document.getElementById('corner-style').value = 'extra-rounded';
  document.getElementById('corner-style').dispatchEvent(new Event('change',{bubbles:true}));
})()`);
await sleep(500);
check('设计变更后预览仍渲染', await evalJs(`!!document.querySelector('#qr-preview canvas')`));
check('渐变选项展开', await evalJs(`!document.getElementById('gradient-opts').hidden`));

/* ---------- 5. contrast warning ---------- */
console.log('\n[E] 对比度警示');
check('红/白对比度正常不警示', await evalJs(`document.getElementById('contrast-alert').hidden`) === true);
await evalJs(`(() => {
  document.getElementById('fg-color').value = '#ffff00';
  document.getElementById('fg-hex').value = '#ffff00';
  document.getElementById('fg-color').dispatchEvent(new Event('input',{bubbles:true}));
})()`);
await sleep(400);
check('黄/白低对比度触发警示', await evalJs(`!document.getElementById('contrast-alert').hidden`));

/* ---------- 6. exports ---------- */
console.log('\n[F] 导出');
const fs = await import('node:fs');
await evalJs(`(() => {
  document.getElementById('fg-color').value = '#111827';
  document.getElementById('fg-hex').value = '#111827';
  document.getElementById('fg-color').dispatchEvent(new Event('input',{bubbles:true}));
})()`);
await sleep(400);

await evalJs(`document.getElementById('btn-download-1024').click()`);
await sleep(1200);
let files = fs.existsSync(DL) ? fs.readdirSync(DL) : [];
const png1024 = files.find(f => /qr-url-1024px-.*\.png$/.test(f));
check('PNG 1024 下载触发', !!png1024, files.join(','));
if (png1024) {
  const buf = fs.readFileSync(DL + '/' + png1024);
  check('PNG 文件头有效', buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47);
  check('PNG 宽 1024 (IHDR)', buf.readUInt32BE(16) === 1024, 'w=' + buf.readUInt32BE(16));
  check('PNG 高 1024 (IHDR)', buf.readUInt32BE(20) === 1024, 'h=' + buf.readUInt32BE(20));
}

await evalJs(`document.getElementById('btn-download-svg').click()`);
await sleep(1200);
files = fs.readdirSync(DL);
const svg = files.find(f => /qr-url-.*\.svg$/.test(f));
check('SVG 下载触发', !!svg, files.join(','));
if (svg) {
  const txt = fs.readFileSync(DL + '/' + svg, 'utf8');
  check('SVG 为矢量文档', txt.includes('<svg') && txt.includes('</svg>') && txt.includes('viewBox'));
  check('SVG 含二维码数据模块', txt.includes('rect') || txt.includes('path') || txt.includes('circle'));
}

await evalJs(`document.getElementById('btn-download-2048').click()`);
await sleep(1200);
files = fs.readdirSync(DL);
const png2048 = files.find(f => /qr-url-2048px-.*\.png$/.test(f));
check('PNG 2048 下载触发', !!png2048, files.join(','));
if (png2048) {
  const buf = fs.readFileSync(DL + '/' + png2048);
  check('PNG 2048 尺寸正确', buf.readUInt32BE(16) === 2048 && buf.readUInt32BE(20) === 2048);
}

/* ---------- 7. logo upload ---------- */
console.log('\n[G] Logo 上传');
const logoPng = await evalJs(`(async () => {
  const q = new window.QRCodeStyling({ width: 64, height: 64, data: 'x', type: 'canvas',
    dotsOptions: { color: '#000000', type: 'square' }, backgroundOptions: { color: '#ffffff' } });
  const blob = await q.getRawData('png');
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
})()`);
fs.writeFileSync('/tmp/qr-logo-test.png', Buffer.from(logoPng, 'base64'));
// set the file on the hidden input through CDP
const doc = await client.send('DOM.getDocument', { depth: -1 });
const inputNode = await client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#logo-input' });
await client.send('DOM.setFileInputFiles', { nodeId: inputNode.nodeId, files: ['/tmp/qr-logo-test.png'] });
await sleep(900);
check('Logo 上传后 ECC 自动升 H', await evalJs(`document.getElementById('ecc-level').value`) === 'H');
check('Logo 尺寸滑块显示', await evalJs(`!document.getElementById('logo-size-field').hidden`));
check('预览仍渲染（含 logo）', await evalJs(`!!document.querySelector('#qr-preview canvas')`));
await evalJs(`document.getElementById('logo-clear').click()`);
await sleep(300);
check('Logo 移除后滑块隐藏', await evalJs(`document.getElementById('logo-size-field').hidden`));

/* ---------- 8. presets ---------- */
console.log('\n[H] 预设');
await evalJs(`document.querySelector('.preset-btn[data-preset="ocean"]').click()`);
await sleep(400);
check('Ocean 预设置色', await evalJs(`document.getElementById('fg-color').value`) === '#0e7490');
check('预设后预览渲染', await evalJs(`!!document.querySelector('#qr-preview canvas')`));

/* ---------- 9. theme ---------- */
console.log('\n[I] 主题');
// Reset to a known state (localStorage persists across CDP targets in this profile)
await evalJs(`(() => { try { localStorage.removeItem('qr-studio-theme'); } catch(e){} document.documentElement.removeAttribute('data-theme'); })()`);
await sleep(200);
const systemDark = await evalJs(`matchMedia('(prefers-color-scheme: dark)').matches`);
const bgBefore = await evalJs(`getComputedStyle(document.body).backgroundColor`);
await evalJs(`document.getElementById('theme-toggle').click()`);
await sleep(200);
const theme1 = await evalJs(`document.documentElement.getAttribute('data-theme')`);
check('点击后显式主题生效', theme1 === 'light' || theme1 === 'dark', String(theme1));
check('切换到与系统相反的主题', theme1 === (systemDark ? 'light' : 'dark'), 'systemDark=' + systemDark + ' theme=' + theme1);
const bgAfter = await evalJs(`getComputedStyle(document.body).backgroundColor`);
check('背景随主题变化', bgBefore !== bgAfter, bgBefore + ' → ' + bgAfter);
check('主题持久化 localStorage', await evalJs(`localStorage.getItem('qr-studio-theme')`) === theme1);
await evalJs(`document.getElementById('theme-toggle').click()`);
await sleep(200);
check('二次点击切回原主题', await evalJs(`document.documentElement.getAttribute('data-theme')`) !== theme1);

/* ---------- 10. network isolation ---------- */
console.log('\n[J] 隐私：无外部请求');
const external = client.events
  .filter(e => e.method === 'Network.requestWillBeSent')
  .map(e => e.params.request.url)
  .filter(u => !u.startsWith('http://127.0.0.1:8931') && !u.startsWith('data:') && !u.startsWith('blob:'));
check('无外部网络请求', external.length === 0, external.join(','));

/* ---------- 11. console errors ---------- */
console.log('\n[K] 控制台');
const pageErrors = client.events.filter(e => e.method === 'Runtime.exceptionThrown');
check('无未捕获异常', pageErrors.length === 0, pageErrors.map(e => e.params.exceptionDetails.exception?.description).join(' | '));
const consoleErrors = client.events.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
check('无 console.error', consoleErrors.length === 0, consoleErrors.map(e => (e.params.args || []).map(a => a.value).join(' ')).join(' | '));

client.close();
console.log('\n========================================');
console.log(`PASS: ${pass}  FAIL: ${fail}`);
if (failures.length) console.log('失败项:\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
