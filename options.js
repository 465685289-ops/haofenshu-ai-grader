const $ = id => document.getElementById(id);
const CUSTOM = '__custom__';

function fillProviders() {
  $('provider').innerHTML = Object.entries(PROVIDERS)
    .map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('');
}

function fillModels(provKey, current) {
  const p = PROVIDERS[provKey] || PROVIDERS.custom;
  const opts = p.models.map(m => `<option value="${m}">${m}</option>`);
  opts.push(`<option value="${CUSTOM}">自定义…</option>`);
  $('model').innerHTML = opts.join('');
  if (current && p.models.includes(current)) {
    $('model').value = current; $('modelCustom').style.display = 'none';
  } else if (current || !p.models.length) {
    $('model').value = CUSTOM; $('modelCustom').style.display = 'block'; $('modelCustom').value = current || '';
  } else {
    $('model').value = p.models[0]; $('modelCustom').style.display = 'none';
  }
  let note = p.note ? (p.textOnly ? `<span class="warn">${p.note}</span>` : p.note) : '';
  if (p.keyUrl) note += `${note ? ' · ' : ''}<a href="${p.keyUrl}" target="_blank">获取 API Key</a>`;
  $('provNote').innerHTML = note;
  $('apiKey').placeholder = p.noKey ? '无需填写' : 'sk-...';
}

function readForm() {
  const model = $('model').value === CUSTOM ? $('modelCustom').value.trim() : $('model').value;
  return {
    provider: $('provider').value,
    model,
    apiKey: $('apiKey').value.trim(),
    baseUrl: $('baseUrl').value.trim(),
    temperature: $('temperature').value === '' ? '' : Number($('temperature').value),
    timeoutSec: Number($('timeoutSec').value) || 90
  };
}

function status(msg, cls) { $('status').className = cls || ''; $('status').textContent = msg; }

async function load() {
  fillProviders();
  const { settings } = await chrome.storage.local.get('settings');
  const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  $('provider').value = s.provider;
  fillModels(s.provider, s.model);
  $('apiKey').value = s.apiKey || '';
  $('baseUrl').value = s.baseUrl || (PROVIDERS[s.provider] || {}).baseUrl || '';
  $('temperature').value = s.temperature;
  $('timeoutSec').value = s.timeoutSec;
}

$('provider').addEventListener('change', () => {
  const k = $('provider').value;
  fillModels(k, null);
  $('baseUrl').value = PROVIDERS[k].baseUrl;
});
$('model').addEventListener('change', () => {
  $('modelCustom').style.display = $('model').value === CUSTOM ? 'block' : 'none';
});
$('toggleKey').addEventListener('click', () => {
  const show = $('apiKey').type === 'password';
  $('apiKey').type = show ? 'text' : 'password';
  $('toggleKey').textContent = show ? '隐藏' : '显示';
});
$('save').addEventListener('click', async () => {
  const s = readForm();
  if (!s.model) return status('请选择或填写模型', 'err');
  await chrome.storage.local.set({ settings: s });
  status('已保存 ✓', 'ok');
});
$('test').addEventListener('click', async () => {
  const s = readForm();
  const c = document.createElement('canvas');
  c.width = 240; c.height = 120;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 240, 120);
  g.fillStyle = '#111'; g.font = 'bold 80px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('37', 120, 64);
  status('正在测试，请稍候…');
  const t0 = Date.now();
  const r = await chrome.runtime.sendMessage({ type: 'testApi', settings: s, image: c.toDataURL('image/png') });
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r || !r.ok) return status('连接失败：' + (r ? r.error : '无响应'), 'err');
  const good = /37/.test(r.text);
  status(good ? `连接成功 ✓ 模型能识图（${sec} 秒）。别忘了点保存。` : `已连通，但识图结果是「${r.text.trim().slice(0, 60)}」，这个模型可能不支持图片。`, good ? 'ok' : 'err');
});

load();
