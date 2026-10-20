/** verify-scan.mjs — scanner-side end-to-end verification in real Chrome. */
const CDP = 'http://127.0.0.1:9222';
const APP = 'http://127.0.0.1:8931/index.html';

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

const fs = await import('node:fs');
const target = await newTarget(APP);
const client = await connect(target.webSocketDebuggerUrl);
await client.send('Runtime.enable');
await client.send('Page.enable');
await client.send('Log.enable');
// reset persisted history so counts are deterministic across runs
await client.send('Runtime.evaluate', { expression: `(() => { try { localStorage.removeItem('qr-studio-history-v1'); } catch(e){} })()` });
await client.send('Page.reload', { ignoreCache: false });
await new Promise(r => setTimeout(r, 2200));

const evalJs = async (expression) => {
  const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)));
  return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Generate a QR PNG in-page and save it to disk; returns the file path. */
async function makeQrFile(data, filename) {
  const b64 = await evalJs(`(async () => {
    const q = new window.QRCodeStyling({ width: 320, height: 320, data: ${JSON.stringify(data)}, type: 'canvas',
      qrOptions: { errorCorrectionLevel: 'M' },
      dotsOptions: { color: '#000000', type: 'square' }, backgroundOptions: { color: '#ffffff' } });
    const blob = await q.getRawData('png');
    const b = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  })()`);
  const path = '/tmp/qr-scan-test/' + filename;
  fs.mkdirSync('/tmp/qr-scan-test', { recursive: true });
  fs.writeFileSync(path, Buffer.from(b64, 'base64'));
  return path;
}

async function uploadToImageInput(path) {
  const doc = await client.send('DOM.getDocument', { depth: -1 });
  const node = await client.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#image-input' });
  await client.send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [path] });
  await sleep(900);
}

/* ---------- A. tab switching ---------- */
console.log('\n[A] Scan 面板');
await evalJs(`document.querySelector('.tab[data-tab="scan"]').click()`);
await sleep(400);
check('scan panel 可见', await evalJs(`!document.getElementById('panel-scan').hidden`));
check('generate panel 隐藏', await evalJs(`document.getElementById('panel-generate').hidden`));
check('摄像头占位显示', await evalJs(`!document.getElementById('camera-placeholder').hidden`));
check('URL hash 更新', await evalJs(`location.hash`) === '#scan');

/* ---------- B. image scan: URL ---------- */
console.log('\n[B] 图片扫描 — URL');
const urlPath = await makeQrFile('https://example.com/hello?x=1', 'url.png');
await uploadToImageInput(urlPath);
check('URL 徽章', await evalJs(`document.getElementById('result-badge').textContent`) === 'URL');
check('URL 结果内容含链接', (await evalJs(`document.getElementById('result-content').textContent`)).includes('https://example.com/hello?x=1'));
check('URL actions 含打开与复制', await evalJs(`Array.from(document.querySelectorAll('#result-actions .btn')).map(b=>b.textContent).join('|')`).then(s => s.includes('Open link') && s.includes('Copy URL')));
check('钓鱼提示显示域名', (await evalJs(`document.getElementById('result-content').textContent`)).includes('example.com'));
check('历史记录 1 条', await evalJs(`document.querySelectorAll('.history-item').length`) === 1);

/* ---------- C. image scan: WiFi ---------- */
console.log('\n[C] 图片扫描 — Wi-Fi');
const wifiPath = await makeQrFile('WIFI:T:WPA;S:StudioNet;P:s3cret!pass;;', 'wifi.png');
await uploadToImageInput(wifiPath);
check('WI-FI 徽章', await evalJs(`document.getElementById('result-badge').textContent`) === 'WI-FI');
const wifiText = await evalJs(`document.getElementById('result-content').textContent`);
check('SSID 解析正确', wifiText.includes('StudioNet'), wifiText);
check('密码解析正确', wifiText.includes('s3cret!pass'), wifiText);
check('历史记录 2 条', await evalJs(`document.querySelectorAll('.history-item').length`) === 2);

/* ---------- D. image scan: vCard ---------- */
console.log('\n[D] 图片扫描 — vCard');
const vcard = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Jane Doe\r\nTEL;TYPE=CELL:+15550100\r\nEMAIL:jane@x.com\r\nORG:Acme\r\nEND:VCARD';
const vcardPath = await makeQrFile(vcard, 'vcard.png');
await uploadToImageInput(vcardPath);
check('CONTACT 徽章', await evalJs(`document.getElementById('result-badge').textContent`) === 'CONTACT');
const vcardText = await evalJs(`document.getElementById('result-content').textContent`);
check('联系人姓名', vcardText.includes('Jane Doe'));
check('联系人电话', vcardText.includes('+15550100'));
check('vcf 下载动作存在', await evalJs(`Array.from(document.querySelectorAll('#result-actions .btn')).map(b=>b.textContent).join('|')`).then(s => s.includes('Save contact (.vcf)')));

/* ---------- E. no QR code found ---------- */
console.log('\n[E] 无码图片');
{
  // plain white PNG via canvas
  const b64 = await evalJs(`(async () => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 200;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,200,200);
    ctx.fillStyle = '#000'; ctx.font = '20px sans-serif'; ctx.fillText('no code here', 20, 100);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const b = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  })()`);
  fs.writeFileSync('/tmp/qr-scan-test/plain.png', Buffer.from(b64, 'base64'));
  await uploadToImageInput('/tmp/qr-scan-test/plain.png');
  check('无码时 toast 提示', await evalJs(`!document.getElementById('toast').hidden && document.getElementById('toast').textContent.includes('No QR code')`));
}

/* ---------- F. history: re-show + delete + clear ---------- */
console.log('\n[F] 历史交互');
check('历史 3 条', await evalJs(`document.querySelectorAll('.history-item').length`) === 3);
await evalJs(`document.querySelectorAll('.history-item .h-text')[1].click()`);
await sleep(300);
check('点击历史重新显示结果', await evalJs(`document.getElementById('result-badge').textContent`) === 'WI-FI');
await evalJs(`document.querySelectorAll('.history-item .h-del')[0].click()`);
await sleep(300);
check('删除单条后剩 2 条', await evalJs(`document.querySelectorAll('.history-item').length`) === 2);
await evalJs(`document.getElementById('btn-history-clear').click()`);
await sleep(300);
check('清空历史', await evalJs(`document.querySelectorAll('.history-item').length`) === 0);
check('清空按钮隐藏', await evalJs(`document.getElementById('btn-history-clear').hidden`));

/* ---------- G. round-trip: scan -> generate ---------- */
console.log('\n[G] 扫描结果回填生成器');
const wifi2 = await makeQrFile('WIFI:T:WPA;S:RoundTrip;P:abc123;H:true;;', 'wifi2.png');
await uploadToImageInput(wifi2);
await evalJs(`Array.from(document.querySelectorAll('#result-actions .btn')).find(b=>b.textContent==='Edit as new QR code').click()`);
await sleep(500);
check('自动切到 generate tab', await evalJs(`document.querySelector('.tab[data-tab="generate"]').classList.contains('active')`));
check('WiFi 类型被选中', await evalJs(`document.querySelector('.type-chip[data-type="wifi"]').classList.contains('active')`));
check('SSID 回填', await evalJs(`document.getElementById('f-ssid').value`) === 'RoundTrip');
check('密码回填', await evalJs(`document.getElementById('f-password').value`) === 'abc123');
check('隐藏网络回填', await evalJs(`document.getElementById('f-hidden').checked`) === true);
check('payload 重建一致', await evalJs(`window.QRGenerator.currentPayload()`) === 'WIFI:T:WPA;S:RoundTrip;P:abc123;H:true;;');
check('预览已渲染', await evalJs(`!!document.querySelector('#qr-preview canvas')`));

/* ---------- H. camera UI states (no real camera in headless) ---------- */
console.log('\n[H] 摄像头 UI');
await evalJs(`document.querySelector('.tab[data-tab="scan"]').click()`);
await sleep(300);
await evalJs(`document.getElementById('btn-camera-start').click()`);
await sleep(2500);
const hintVisible = await evalJs(`!document.getElementById('camera-hint').hidden`);
const hintText = await evalJs(`document.getElementById('camera-hint').textContent`);
check('无摄像头设备时有提示或正常启动', hintVisible === true || await evalJs(`!document.getElementById('scan-overlay').hidden`), hintText || '(no hint)');
check('无未捕获异常', (() => {
  const errs = client.events.filter(e => e.method === 'Runtime.exceptionThrown');
  return errs.length === 0;
})());

/* ---------- I. responsive ---------- */
console.log('\n[I] 响应式');
await evalJs(`document.querySelector('.tab[data-tab="generate"]').click()`);
await client.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
await sleep(500);
const cols = await evalJs(`getComputedStyle(document.querySelector('.gen-layout')).gridTemplateColumns`);
check('375px 下生成区单列', cols.split(' ').length === 1, cols);
check('页面无横向溢出', await evalJs(`document.documentElement.scrollWidth <= 375`) === true, await evalJs(`String(document.documentElement.scrollWidth)`));
await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
await sleep(300);
const colsWide = await evalJs(`getComputedStyle(document.querySelector('.gen-layout')).gridTemplateColumns`);
check('1440px 下恢复双列', colsWide.split(' ').length === 2, colsWide);

/* ---------- J. console ---------- */
console.log('\n[J] 控制台');
const pageErrors = client.events.filter(e => e.method === 'Runtime.exceptionThrown');
check('无未捕获异常', pageErrors.length === 0, pageErrors.map(e => e.params.exceptionDetails.exception?.description).join(' | '));
const consoleErrors = client.events.filter(e => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error');
check('无 console.error', consoleErrors.length === 0, consoleErrors.map(e => (e.params.args || []).map(a => a.value).join(' ')).join(' | '));

client.close();
console.log('\n========================================');
console.log(`PASS: ${pass}  FAIL: ${fail}`);
if (failures.length) console.log('失败项:\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
