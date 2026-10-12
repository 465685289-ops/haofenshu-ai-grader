importScripts('providers.js');

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return Object.assign({}, DEFAULT_SETTINGS, settings || {});
}

function abToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin);
}

function splitDataUrl(u) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(u || '');
  return m ? { mime: m[1], data: m[2] } : { mime: 'image/jpeg', data: '' };
}

function buildPrompt(p) {
  const system =
    '你是一位严谨、公正、经验丰富的阅卷老师，正在进行网上阅卷。你会看到学生答题区域的扫描图片。' +
    '请先准确识别学生的手写内容，再严格依据评分标准和参考答案给分。' +
    '空白、无法辨认或明显答非所问的给 0 分。不要因为字迹潦草而随意扣分，除非标准要求。' +
    '最终只输出一个 JSON 对象，不要输出任何其他文字。';
  const lines = [
    `【本题满分】${p.fullScore} 分`,
    `【给分步长】${p.step} 分（分数必须是步长的整数倍，范围 0~${p.fullScore}）`
  ];
  if (p.question) lines.push(`【题目】\n${p.question}`);
  if (p.answerRef) lines.push(`【参考答案】\n${p.answerRef}`);
  if (p.rubric) lines.push(`【评分标准】\n${p.rubric}`);
  if (p.extra) lines.push(`【补充要求】\n${p.extra}`);
  lines.push(
    '请输出如下 JSON：\n' +
    '{"recognized":"学生答案的文字转写（作文可只概括）","score":数字,"reason":"给分/扣分理由，简明，对应评分点","confidence":0到1之间的小数，表示你对这个分数的把握}'
  );
  return { system, user: lines.join('\n\n') };
}

async function fetchWithTimeout(url, opts, sec) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), sec * 1000);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`请求超时（${sec} 秒）`);
    throw new Error('网络请求失败：' + e.message);
  } finally {
    clearTimeout(t);
  }
}

async function readError(res) {
  let txt = '';
  try { txt = await res.text(); } catch (_) {}
  let msg = txt;
  try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error)) || j.message || txt; } catch (_) {}
  if (typeof msg !== 'string') msg = JSON.stringify(msg);
  return `HTTP ${res.status}：${msg.slice(0, 300)}`;
}

async function callModel(settings, system, userText, images, useTemp = true) {
  const prov = PROVIDERS[settings.provider] || PROVIDERS.custom;
  const base = (settings.baseUrl || prov.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('请先在设置里填写接口地址');
  if (!settings.model) throw new Error('请先在设置里选择模型');
  if (!settings.apiKey && !prov.noKey) throw new Error('请先在设置里填写 API Key');
  if (prov.textOnly && images.length) throw new Error(`${prov.name} 不支持识图，请换一个视觉模型`);
  const sec = Number(settings.timeoutSec) || 90;
  const temp = Number(settings.temperature);
  let res, text = '';

  if (prov.format === 'anthropic') {
    const content = images.map(u => {
      const { mime, data } = splitDataUrl(u);
      return { type: 'image', source: { type: 'base64', media_type: mime, data } };
    });
    content.push({ type: 'text', text: userText });
    const body = { model: settings.model, max_tokens: 1500, system, messages: [{ role: 'user', content }] };
    if (useTemp && !isNaN(temp)) body.temperature = temp;
    res = await fetchWithTimeout(base + '/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    }, sec);
    if (!res.ok) { const err = await readError(res); if (useTemp && /temperature/i.test(err)) return callModel(settings, system, userText, images, false); throw new Error(err); }
    const j = await res.json();
    text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  } else if (prov.format === 'gemini') {
    const parts = [{ text: userText }];
    images.forEach(u => { const { mime, data } = splitDataUrl(u); parts.push({ inline_data: { mime_type: mime, data } }); });
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }] };
    if (useTemp && !isNaN(temp)) body.generationConfig = { temperature: temp };
    res = await fetchWithTimeout(`${base}/models/${encodeURIComponent(settings.model)}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }, sec);
    if (!res.ok) throw new Error(await readError(res));
    const j = await res.json();
    const c = j.candidates && j.candidates[0];
    text = c && c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('\n') : '';
  } else {
    const content = [{ type: 'text', text: userText }];
    images.forEach(u => content.push({ type: 'image_url', image_url: { url: u } }));
    const body = { model: settings.model, messages: [{ role: 'system', content: system }, { role: 'user', content }] };
    if (useTemp && !isNaN(temp)) body.temperature = temp;
    const headers = { 'content-type': 'application/json' };
    if (settings.apiKey) headers.Authorization = 'Bearer ' + settings.apiKey;
    if (settings.provider === 'openrouter') { headers['X-Title'] = 'AI Grader'; }
    res = await fetchWithTimeout(base + '/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) }, sec);
    if (!res.ok) { const err = await readError(res); if (useTemp && /temperature/i.test(err)) return callModel(settings, system, userText, images, false); throw new Error(err); }
    const j = await res.json();
    const msg = j.choices && j.choices[0] && j.choices[0].message;
    if (!msg) throw new Error('模型返回为空：' + JSON.stringify(j).slice(0, 200));
    text = Array.isArray(msg.content) ? msg.content.map(c => c.text || '').join('\n') : (msg.content || '');
  }
  if (!text) throw new Error('模型没有返回内容');
  return text;
}

function parseResult(raw, fullScore) {
  let t = String(raw).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1];
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  let obj = null;
  if (a >= 0 && b > a) { try { obj = JSON.parse(t.slice(a, b + 1)); } catch (_) {} }
  if (!obj) {
    const m = /"?score"?\s*[:：]\s*(-?\d+(?:\.\d+)?)/i.exec(t) || /(\d+(?:\.\d+)?)\s*分/.exec(t);
    if (!m) throw new Error('无法解析模型输出：' + t.slice(0, 150));
    obj = { score: Number(m[1]), reason: t.slice(0, 200), confidence: 0.3 };
  }
  const score = Number(obj.score);
  if (isNaN(score)) throw new Error('模型没有给出有效分数');
  let conf = Number(obj.confidence);
  if (isNaN(conf)) conf = 0.5;
  if (conf > 1) conf = conf / 100;
  return { score, reason: String(obj.reason || ''), recognized: String(obj.recognized || ''), confidence: conf, fullScore };
}

async function grade(msg) {
  const settings = await getSettings();
  const { system, user } = buildPrompt(msg.profile);
  const raw = await callModel(settings, system, user, msg.images || []);
  const r = parseResult(raw, msg.profile.fullScore);
  r.raw = raw;
  r.model = settings.model;
  return r;
}

async function fetchImage(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('图片下载失败 HTTP ' + res.status);
  const type = res.headers.get('content-type') || 'image/png';
  const buf = await res.arrayBuffer();
  return `data:${type.split(';')[0]};base64,${abToBase64(buf)}`;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = p => p.then(r => sendResponse(Object.assign({ ok: true }, r))).catch(e => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  switch (msg && msg.type) {
    case 'capture':
      reply(chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }).then(dataUrl => ({ dataUrl })));
      return true;
    case 'fetchImage':
      reply(fetchImage(msg.url).then(dataUrl => ({ dataUrl })));
      return true;
    case 'grade':
      reply(grade(msg));
      return true;
    case 'testApi':
      reply((async () => {
        const s = Object.assign({}, DEFAULT_SETTINGS, msg.settings || {});
        const text = await callModel(s, '你是一个测试助手。', '图片里写的数字是几？只回答这个数字。', msg.image ? [msg.image] : []);
        return { text };
      })());
      return true;
    case 'openOptions':
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;
  }
  return false;
});
