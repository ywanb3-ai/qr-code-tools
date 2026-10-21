/** verify-camera.mjs — real getUserMedia + live decode chain via fake capture device. */
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

const target = await newTarget(APP);
const client = await connect(target.webSocketDebuggerUrl);
await client.send('Runtime.enable');
await client.send('Page.enable');
await client.send('Log.enable');
await client.send('Browser.grantPermissions', { origin: 'http://127.0.0.1:8931', permissions: ['videoCapture', 'audioCapture'] });
await new Promise(r => setTimeout(r, 2200));

const evalJs = async (expression) => {
  const r = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + (r.exceptionDetails.exception?.description));
  return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* go to scan tab */
await evalJs(`document.querySelector('.tab[data-tab="scan"]').click()`);
await sleep(400);

console.log('\n[A] getUserMedia 链路');
await evalJs(`document.getElementById('btn-camera-start').click()`);
await sleep(3000);

check('无错误提示（权限/设备 OK）', await evalJs(`document.getElementById('camera-hint').hidden`), await evalJs(`document.getElementById('camera-hint').textContent`));
check('摄像头 UI 进入激活态', await evalJs(`document.getElementById('btn-camera-start').hidden && !document.getElementById('scan-overlay').hidden`));
check('video 有画面尺寸', await evalJs(`document.getElementById('camera-video').videoWidth`) === 640, await evalJs(`String(document.getElementById('camera-video').videoWidth)`));
check('video 正在播放', await evalJs(`!document.getElementById('camera-video').paused`));
check('start 按钮切换为 stop', await evalJs(`!document.getElementById('btn-camera-stop').hidden`));

console.log('\n[B] 实时解码（假摄像头播放 QR 画面）');
// poll up to 8s for a decode result
let badge = '';
let visible = false;
for (let i = 0; i < 16; i++) {
  await sleep(500);
  visible = await evalJs(`!document.getElementById('result-body').hidden`);
  if (visible) { badge = await evalJs(`document.getElementById('result-badge').textContent`); break; }
}
check('实时扫描解码出结果', !!badge, 'badge=' + badge);
check('结果类型 URL', badge === 'URL', badge);
const content = await evalJs(`document.getElementById('result-content').textContent`);
check('解码内容正确', content.includes('https://example.com/camera-e2e'), content);
check('历史记录写入', await evalJs(`document.querySelectorAll('.history-item').length`) >= 1);

console.log('\n[C] 停止与恢复');
await evalJs(`document.getElementById('btn-camera-stop').click()`);
await sleep(400);
check('stop 后 UI 复位', await evalJs(`document.getElementById('btn-camera-start').hidden`) === false && await evalJs(`document.getElementById('scan-overlay').hidden`));
check('stop 后 video 流释放', await evalJs(`document.getElementById('camera-video').srcObject`) === null);

console.log('\n[D] 控制台');
const pageErrors = client.events.filter(e => e.method === 'Runtime.exceptionThrown');
check('无未捕获异常', pageErrors.length === 0, pageErrors.map(e => e.params.exceptionDetails.exception?.description).join(' | '));

client.close();
console.log('\n========================================');
console.log(`PASS: ${pass}  FAIL: ${fail}`);
if (failures.length) console.log('失败项:\n - ' + failures.join('\n - '));
process.exit(fail ? 1 : 0);
