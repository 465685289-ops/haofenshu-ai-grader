(() => {
  if (window.top !== window) return;               // 只在顶层页面运行
  if (window.__aiGraderLoaded) return;
  window.__aiGraderLoaded = true;

  /* ================= 工具 ================= */
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const raf2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const send = msg => new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, r => resolve(r || { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : '无响应' })); }
    catch (e) { resolve({ ok: false, error: '插件已更新，请刷新页面' }); }
  });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const HOSTKEY = 'graderCfg:' + location.host;

  const DEFAULT_CFG = {
    answerSel: '', answerRect: null, scoreSel: '', submitSel: '',
    submitMode: 'auto',          // auto | click | enter | none
    imgMode: 'auto',             // auto | screenshot
    fullScore: 10, step: 1, question: '', answerRef: '', rubric: '', extra: '',
    runMode: 'auto',             // auto 全自动 | confirm 每题确认
    minConf: 0.6, delay: 800, maxCount: 0, panelPos: null, profileName: ''
  };
  let cfg = Object.assign({}, DEFAULT_CFG);
  const state = { running: false, paused: false, stopFlag: false, count: 0, total: 0, log: [], confirmResolve: null };

  async function loadCfg() {
    const o = await chrome.storage.local.get(HOSTKEY);
    cfg = Object.assign({}, DEFAULT_CFG, o[HOSTKEY] || {});
  }
  function saveCfg() { chrome.storage.local.set({ [HOSTKEY]: cfg }); }

  /* ================= CSS 选择器生成 ================= */
  function cssPath(el) {
    if (!(el instanceof Element)) return '';
    if (el.id && !/\d{3,}/.test(el.id) && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && !/\d{3,}/.test(cur.id) && /^[A-Za-z][\w-]*$/.test(cur.id)) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      const cls = [...cur.classList].filter(c => /^[A-Za-z_-][\w-]*$/.test(c) && !/\d{4,}/.test(c) && !/(hover|active|focus|selected|current|checked)/i.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.map(c => CSS.escape(c)).join('.');
      const parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter(s => s.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      const sel = parts.join(' > ');
      try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (_) {}
      cur = parent;
    }
    return parts.join(' > ');
  }
  const q = sel => { if (!sel) return null; try { return document.querySelector(sel); } catch (_) { return null; } };

  /* ================= 扫描动画层 ================= */
  const scanHost = document.createElement('div');
  scanHost.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483646;pointer-events:none;';
  const scanRoot = scanHost.attachShadow({ mode: 'open' });
  scanRoot.innerHTML = `
  <style>
    .wrap{position:fixed;pointer-events:none;border-radius:6px;overflow:hidden;opacity:0;transition:opacity .25s, box-shadow .3s;
      box-shadow:0 0 0 2px rgba(0,229,255,.9),0 0 22px rgba(0,229,255,.55),inset 0 0 40px rgba(0,229,255,.18);}
    .wrap.on{opacity:1}
    .tint{position:absolute;inset:0;background:rgba(0,60,90,.10)}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(0,229,255,.14) 1px,transparent 1px),linear-gradient(90deg,rgba(0,229,255,.14) 1px,transparent 1px);
      background-size:24px 24px;animation:gp 2.4s ease-in-out infinite}
    @keyframes gp{0%,100%{opacity:.35}50%{opacity:.9}}
    .beam{position:absolute;left:0;right:0;height:42%;top:-42%;
      background:linear-gradient(to bottom,rgba(0,229,255,0),rgba(0,229,255,.06) 55%,rgba(0,229,255,.38));
      animation:sc 1.9s cubic-bezier(.5,.1,.5,.9) infinite}
    .beam::after{content:'';position:absolute;left:0;right:0;bottom:0;height:2px;background:#aefbff;box-shadow:0 0 10px 3px #00e5ff,0 0 26px 6px rgba(0,229,255,.6)}
    @keyframes sc{0%{top:-42%}100%{top:100%}}
    .c{position:absolute;width:22px;height:22px;border:3px solid #00e5ff;filter:drop-shadow(0 0 4px #00e5ff);animation:cp 1.2s ease-in-out infinite}
    .tl{left:4px;top:4px;border-right:0;border-bottom:0}.tr{right:4px;top:4px;border-left:0;border-bottom:0}
    .bl{left:4px;bottom:4px;border-right:0;border-top:0}.br{right:4px;bottom:4px;border-left:0;border-top:0}
    @keyframes cp{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}
    .label{position:absolute;left:12px;top:12px;padding:5px 12px;border-radius:999px;background:rgba(0,22,34,.82);color:#bff8ff;
      font:600 13px/1.2 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:1px;display:flex;align-items:center;gap:8px;
      box-shadow:0 0 12px rgba(0,229,255,.5)}
    .dot{width:8px;height:8px;border-radius:50%;background:#00e5ff;animation:bl .8s infinite alternate;box-shadow:0 0 8px #00e5ff}
    @keyframes bl{from{opacity:.25}to{opacity:1}}
    .badge{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) scale(.4);opacity:0;padding:14px 26px;border-radius:16px;
      font:800 34px/1 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#fff;background:rgba(43,138,62,.92);
      box-shadow:0 8px 30px rgba(0,0,0,.25);transition:all .35s cubic-bezier(.2,1.6,.4,1)}
    .badge small{font-size:16px;font-weight:600;opacity:.85;margin-left:4px}
    .wrap.done{box-shadow:0 0 0 2px rgba(64,192,87,.95),0 0 26px rgba(64,192,87,.6),inset 0 0 40px rgba(64,192,87,.18)}
    .wrap.done .beam,.wrap.done .grid,.wrap.err .beam,.wrap.err .grid{display:none}
    .wrap.done .c{border-color:#40c057;filter:drop-shadow(0 0 4px #40c057)}
    .wrap.done .badge,.wrap.err .badge{opacity:1;transform:translate(-50%,-50%) scale(1)}
    .wrap.err{box-shadow:0 0 0 2px rgba(250,82,82,.95),0 0 26px rgba(250,82,82,.6)}
    .wrap.err .badge{background:rgba(201,42,42,.92);font-size:18px}
    .wrap.warn .badge{background:rgba(230,119,0,.95)}
  </style>
  <div class="wrap" id="w"><div class="tint"></div><div class="grid"></div><div class="beam"></div>
    <i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>
    <div class="label"><span class="dot"></span><span id="lt">AI 正在阅卷</span></div>
    <div class="badge" id="bd"></div></div>`;
  const scanW = scanRoot.getElementById('w');
  let scanTrack = null, scanHideTimer = null;

  function regionRect() {
    const el = q(cfg.answerSel);
    if (el) { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
    if (cfg.answerRect) return Object.assign({}, cfg.answerRect);
    return null;
  }
  function placeScan() {
    const r = regionRect();
    if (r) Object.assign(scanW.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    scanTrack = requestAnimationFrame(placeScan);
  }
  function showScan(text) {
    clearTimeout(scanHideTimer);
    scanW.className = 'wrap';
    scanRoot.getElementById('lt').textContent = text || 'AI 正在阅卷';
    scanRoot.getElementById('bd').innerHTML = '';
    if (!scanTrack) placeScan();
    requestAnimationFrame(() => scanW.classList.add('on'));
  }
  function finishScan(kind, html, holdMs) {
    scanW.className = 'wrap on ' + kind;
    scanRoot.getElementById('bd').innerHTML = html;
    scanHideTimer = setTimeout(hideScan, holdMs || 900);
  }
  function hideScan() {
    scanW.classList.remove('on');
    setTimeout(() => { if (!scanW.classList.contains('on')) { cancelAnimationFrame(scanTrack); scanTrack = null; } }, 300);
  }

  /* ================= 面板 ================= */
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483647;top:80px;right:20px;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    *{box-sizing:border-box}
    .p{width:330px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;background:#fff;border-radius:14px;
      box-shadow:0 10px 40px rgba(0,30,50,.22);font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1d2733;overflow:hidden}
    .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#0b2a45,#0f4c6e);color:#fff;cursor:move;user-select:none}
    .hd b{flex:1;font-size:14px;letter-spacing:.5px}
    .hd .st{font-size:11px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.15)}
    .hd button{border:0;background:rgba(255,255,255,.15);color:#fff;width:24px;height:24px;border-radius:6px;cursor:pointer}
    .bd{overflow:auto;padding:10px 12px 12px}
    details{border:1px solid #e6ecf1;border-radius:10px;margin-bottom:8px}
    summary{padding:8px 10px;font-weight:600;cursor:pointer;list-style:none;display:flex;justify-content:space-between}
    summary::after{content:'▸';color:#8a97a5}
    details[open] summary::after{content:'▾'}
    .sec{padding:0 10px 10px}
    label{display:block;font-size:12px;color:#556270;margin:8px 0 3px}
    input,select,textarea{width:100%;padding:6px 8px;border:1px solid #d5dde6;border-radius:7px;font:inherit;background:#fff}
    textarea{resize:vertical;min-height:54px}
    input:focus,select:focus,textarea:focus{outline:none;border-color:#00b8d4}
    .r{display:flex;gap:8px}.r>*{flex:1}
    .btn{border:0;border-radius:8px;padding:7px 10px;cursor:pointer;font:600 13px/1.2 inherit;background:#eef3f7;color:#1d2733}
    .btn:hover{filter:brightness(.96)}
    .pri{background:#00b8d4;color:#fff}.dan{background:#fa5252;color:#fff}.ok{background:#2b8a3e;color:#fff}.warnb{background:#f59f00;color:#fff}
    .big{width:100%;padding:11px;font-size:14px}
    .loc{display:flex;align-items:center;gap:6px;margin-top:6px}
    .loc span{flex:1;font-size:12px;color:#8a97a5;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .loc span.set{color:#2b8a3e}
    .ctrl{display:flex;gap:6px;margin:6px 0 8px}.ctrl .btn{flex:1}
    .res{background:#f6f9fb;border-radius:10px;padding:10px;margin-top:4px;font-size:12px}
    .res .sc{font-size:22px;font-weight:800;color:#0f4c6e}
    .res .sc small{font-size:12px;color:#8a97a5;font-weight:600;margin-left:6px}
    .muted{color:#8a97a5;font-size:12px}
    .cf{border:2px solid #f59f00;background:#fff9db;border-radius:10px;padding:10px;margin-top:8px}
    .cf input{font-size:18px;font-weight:700;text-align:center}
    .stat{display:flex;justify-content:space-between;font-size:12px;color:#556270;margin-top:6px}
    .mini{display:none}
    .min .bd{display:none}.min .p{width:auto}
    .kb{font-size:11px;color:#8a97a5;margin-top:8px}
    kbd{background:#eef3f7;border-radius:4px;padding:0 4px;font-family:inherit}
  </style>
  <div class="p">
    <div class="hd" id="drag"><b>AI 阅卷助手</b><span class="st" id="st">空闲</span>
      <button id="minb" title="收起">–</button><button id="close" title="关闭">×</button></div>
    <div class="bd">
      <div class="ctrl">
        <button class="btn pri" id="start">▶ 开始连续批改</button>
        <button class="btn" id="one" title="只批当前一题，不提交">试批一题</button>
      </div>
      <div class="ctrl" id="runCtrl" style="display:none">
        <button class="btn warnb" id="pause">⏸ 暂停</button>
        <button class="btn dan" id="stop">■ 停止</button>
      </div>
      <div id="confirm"></div>
      <div class="res" id="res"><span class="muted">先在「① 页面定位」里点选答题区、分数框和提交按钮，再在「② 本题评分标准」里填满分和标准。</span></div>
      <div class="stat"><span id="cnt">已批 0 题</span><span id="model"></span></div>

      <details id="dLoc" style="margin-top:10px"><summary>① 页面定位</summary><div class="sec">
        <div class="loc"><button class="btn" id="pkA">选答题区</button><button class="btn" id="dragA" title="答题区是画布等无法点选时用">框选</button><span id="lA">未设置</span></div>
        <div class="loc"><button class="btn" id="pkS">选分数框</button><span id="lS">未设置</span></div>
        <div class="loc"><button class="btn" id="pkB">选提交按钮</button><span id="lB">未设置（可不选）</span></div>
        <div class="muted" style="margin-top:6px">点选时：鼠标移到目标上点击；按 <kbd>↑</kbd> 扩大到父元素，<kbd>Esc</kbd> 取消。分数框可以是输入框，也可以是一排分值按钮的外框。</div>
        <label>提交方式</label>
        <select id="submitMode">
          <option value="auto">自动（有提交按钮就点，否则按回车）</option>
          <option value="click">点击提交按钮</option>
          <option value="enter">在分数框按回车</option>
          <option value="none">填分后页面自动跳题，无需提交</option>
        </select>
        <label>图片获取</label>
        <select id="imgMode">
          <option value="auto">自动（优先原图，失败则截屏）</option>
          <option value="screenshot">始终截屏答题区</option>
        </select>
      </div></details>

      <details id="dRub" open><summary>② 本题评分标准</summary><div class="sec">
        <div class="r"><div><label>题目方案</label><select id="prof"><option value="">（未保存）</option></select></div></div>
        <div class="r">
          <div><label>满分</label><input id="fullScore" type="number" min="0" step="0.5"></div>
          <div><label>给分步长</label><select id="step"><option value="1">1 分</option><option value="0.5">0.5 分</option><option value="2">2 分</option></select></div>
        </div>
        <label>题目（可选）</label><textarea id="question" placeholder="粘贴题干，有助于 AI 理解"></textarea>
        <label>参考答案</label><textarea id="answerRef" placeholder="标准答案 / 答案要点"></textarea>
        <label>评分标准</label><textarea id="rubric" placeholder="例：答出“…”得 2 分；答出“…”得 2 分；语言通顺 1 分…"></textarea>
        <label>补充要求（可选）</label><textarea id="extra" placeholder="例：错别字每 3 个扣 1 分；意思对即可，不必原词"></textarea>
        <div class="ctrl" style="margin-top:8px"><button class="btn" id="saveProf">保存为方案</button><button class="btn" id="delProf">删除方案</button></div>
      </div></details>

      <details id="dRun"><summary>③ 运行设置</summary><div class="sec">
        <label>模式</label>
        <select id="runMode">
          <option value="auto">全自动：给分 → 提交 → 下一题</option>
          <option value="confirm">每题确认：AI 给分后由我确认再提交</option>
        </select>
        <div class="r">
          <div><label>置信度低于此值时暂停</label><input id="minConf" type="number" min="0" max="1" step="0.05"></div>
          <div><label>每题间隔(毫秒)</label><input id="delay" type="number" min="0" step="100"></div>
        </div>
        <label>最多批改题数（0 = 不限）</label><input id="maxCount" type="number" min="0" step="1">
        <div class="ctrl" style="margin-top:8px"><button class="btn" id="exp">导出批改记录 CSV</button><button class="btn" id="opt">模型设置</button></div>
      </div></details>
      <div class="kb"><kbd>Alt</kbd>+<kbd>S</kbd> 开始/暂停　<kbd>Alt</kbd>+<kbd>X</kbd> 停止</div>
    </div>
  </div>`;
  const $ = id => root.getElementById(id);
  let mounted = false;

  function mount() {
    if (mounted) { host.style.display = ''; return; }
    document.documentElement.appendChild(scanHost);
    document.documentElement.appendChild(host);
    mounted = true;
    if (cfg.panelPos) Object.assign(host.style, { left: cfg.panelPos.left + 'px', top: cfg.panelPos.top + 'px', right: 'auto' });
    renderCfg(); renderProfiles(); renderModel();
  }

  function setStatus(t) { $('st').textContent = t; }
  function setRes(html) { $('res').innerHTML = html; }

  function renderCfg() {
    ['fullScore', 'step', 'question', 'answerRef', 'rubric', 'extra', 'runMode', 'minConf', 'delay', 'maxCount', 'submitMode', 'imgMode']
      .forEach(k => { $(k).value = cfg[k]; });
    const setL = (id, ok, txt) => { $(id).textContent = txt; $(id).className = ok ? 'set' : ''; };
    if (q(cfg.answerSel)) setL('lA', true, '✓ 已选元素');
    else if (cfg.answerRect) setL('lA', true, `✓ 已框选 ${Math.round(cfg.answerRect.width)}×${Math.round(cfg.answerRect.height)}`);
    else setL('lA', false, cfg.answerSel ? '⚠ 当前页找不到，请重选' : '未设置');
    setL('lS', !!q(cfg.scoreSel), q(cfg.scoreSel) ? '✓ 已选' : (cfg.scoreSel ? '⚠ 找不到，请重选' : '未设置'));
    setL('lB', !!q(cfg.submitSel), q(cfg.submitSel) ? '✓ 已选' : '未设置（可不选）');
  }
  async function renderModel() {
    const { settings } = await chrome.storage.local.get('settings');
    $('model').textContent = settings && settings.model ? settings.model : '⚠ 未设置模型';
  }
  async function renderProfiles() {
    const { graderProfiles = {} } = await chrome.storage.local.get('graderProfiles');
    $('prof').innerHTML = '<option value="">（未保存）</option>' + Object.keys(graderProfiles).map(n => `<option>${esc(n)}</option>`).join('');
    $('prof').value = cfg.profileName && graderProfiles[cfg.profileName] ? cfg.profileName : '';
  }

  // 表单变化写回配置
  ['fullScore', 'minConf', 'delay', 'maxCount', 'step'].forEach(k => $(k).addEventListener('change', () => { cfg[k] = Number($(k).value); saveCfg(); }));
  ['question', 'answerRef', 'rubric', 'extra', 'runMode', 'submitMode', 'imgMode'].forEach(k => $(k).addEventListener('change', () => { cfg[k] = $(k).value; saveCfg(); }));

  const PROF_KEYS = ['fullScore', 'step', 'question', 'answerRef', 'rubric', 'extra'];
  $('saveProf').onclick = async () => {
    const name = prompt('给这道题的方案起个名字（如：第 17 题 文言翻译）', cfg.profileName || '');
    if (!name) return;
    const { graderProfiles = {} } = await chrome.storage.local.get('graderProfiles');
    graderProfiles[name] = {}; PROF_KEYS.forEach(k => graderProfiles[name][k] = cfg[k]);
    await chrome.storage.local.set({ graderProfiles });
    cfg.profileName = name; saveCfg(); renderProfiles();
  };
  $('delProf').onclick = async () => {
    const n = $('prof').value; if (!n || !confirm(`删除方案「${n}」？`)) return;
    const { graderProfiles = {} } = await chrome.storage.local.get('graderProfiles');
    delete graderProfiles[n]; await chrome.storage.local.set({ graderProfiles });
    cfg.profileName = ''; saveCfg(); renderProfiles();
  };
  $('prof').onchange = async () => {
    const n = $('prof').value; if (!n) return;
    const { graderProfiles = {} } = await chrome.storage.local.get('graderProfiles');
    Object.assign(cfg, graderProfiles[n] || {}); cfg.profileName = n; saveCfg(); renderCfg();
  };
  $('opt').onclick = () => send({ type: 'openOptions' });
  $('exp').onclick = exportCsv;
  $('close').onclick = () => { stopRun(); host.style.display = 'none'; };
  $('minb').onclick = () => { host.classList.toggle('min'); root.querySelector('.bd').style.display = host.classList.contains('min') ? 'none' : ''; $('minb').textContent = host.classList.contains('min') ? '+' : '–'; };

  // 拖动面板
  (() => {
    let sx, sy, ox, oy, on = false;
    $('drag').addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      on = true; const r = host.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!on) return;
      const left = Math.max(0, Math.min(window.innerWidth - 80, ox + e.clientX - sx));
      const top = Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy));
      Object.assign(host.style, { left: left + 'px', top: top + 'px', right: 'auto' });
    });
    window.addEventListener('mouseup', () => {
      if (!on) return; on = false;
      const r = host.getBoundingClientRect(); cfg.panelPos = { left: r.left, top: r.top }; saveCfg();
    });
  })();

  /* ================= 元素点选 / 框选 ================= */
  function pickElement(title) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483645;border:2px solid #00e5ff;background:rgba(0,229,255,.12);border-radius:4px;transition:all .06s;box-shadow:0 0 0 9999px rgba(0,20,30,.15)';
      const tip = document.createElement('div');
      tip.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483647;background:#0b2a45;color:#fff;padding:8px 16px;border-radius:999px;font:600 13px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25)';
      tip.textContent = `${title}：点击目标　↑ 选父元素　Esc 取消`;
      document.documentElement.append(box, tip);
      host.style.visibility = 'hidden';
      let cur = null;
      const draw = () => { if (!cur) return; const r = cur.getBoundingClientRect(); Object.assign(box.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); };
      const over = e => { cur = e.target; draw(); };
      const block = e => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
      const click = e => { block(e); done(cur); };
      const key = e => {
        if (e.key === 'Escape') { block(e); done(null); }
        if (e.key === 'ArrowUp' && cur && cur.parentElement && cur.parentElement !== document.body) { block(e); cur = cur.parentElement; draw(); }
      };
      function done(el) {
        document.removeEventListener('mouseover', over, true);
        ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => document.removeEventListener(t, t === 'click' ? click : block, true));
        document.removeEventListener('keydown', key, true);
        box.remove(); tip.remove(); host.style.visibility = '';
        resolve(el);
      }
      document.addEventListener('mouseover', over, true);
      ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(t => document.addEventListener(t, t === 'click' ? click : block, true));
      document.addEventListener('keydown', key, true);
    });
  }
  function dragRect() {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.style.cssText = 'position:fixed;inset:0;z-index:2147483645;cursor:crosshair;background:rgba(0,20,30,.25)';
      const sel = document.createElement('div');
      sel.style.cssText = 'position:fixed;border:2px solid #00e5ff;background:rgba(0,229,255,.12);display:none;pointer-events:none';
      mask.appendChild(sel);
      document.documentElement.appendChild(mask);
      host.style.visibility = 'hidden';
      let sx, sy, r = null;
      mask.onmousedown = e => { sx = e.clientX; sy = e.clientY; sel.style.display = 'block'; };
      mask.onmousemove = e => {
        if (sx == null) return;
        r = { left: Math.min(sx, e.clientX), top: Math.min(sy, e.clientY), width: Math.abs(e.clientX - sx), height: Math.abs(e.clientY - sy) };
        Object.assign(sel.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
      };
      const end = v => { mask.remove(); host.style.visibility = ''; document.removeEventListener('keydown', k, true); resolve(v); };
      mask.onmouseup = () => end(r && r.width > 20 && r.height > 20 ? r : null);
      const k = e => { if (e.key === 'Escape') end(null); };
      document.addEventListener('keydown', k, true);
    });
  }
  $('pkA').onclick = async () => { const el = await pickElement('选择答题区'); if (el) { cfg.answerSel = cssPath(el); cfg.answerRect = null; saveCfg(); } renderCfg(); };
  $('dragA').onclick = async () => { const r = await dragRect(); if (r) { cfg.answerRect = r; cfg.answerSel = ''; saveCfg(); } renderCfg(); };
  $('pkS').onclick = async () => { const el = await pickElement('选择分数输入框 / 分值按钮区'); if (el) { cfg.scoreSel = cssPath(el); saveCfg(); } renderCfg(); };
  $('pkB').onclick = async () => { const el = await pickElement('选择提交按钮'); if (el) { cfg.submitSel = cssPath(el); saveCfg(); } renderCfg(); };

  /* ================= 取图 ================= */
  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('图片加载失败')); i.src = src; });
  }
  function toJpeg(img, sx, sy, sw, sh, maxSide = 1800) {
    const k = Math.min(1, maxSide / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  }
  async function screenshotRegion(r) {
    host.style.visibility = 'hidden'; scanHost.style.visibility = 'hidden';
    await raf2(); await sleep(60);
    const resp = await send({ type: 'capture' });
    host.style.visibility = ''; scanHost.style.visibility = '';
    if (!resp.ok) throw new Error('截屏失败：' + resp.error);
    const img = await loadImg(resp.dataUrl);
    const ratio = img.width / window.innerWidth;
    const left = Math.max(0, r.left), top = Math.max(0, r.top);
    const right = Math.min(window.innerWidth, r.left + r.width), bottom = Math.min(window.innerHeight, r.top + r.height);
    if (right - left < 10 || bottom - top < 10) throw new Error('答题区不在可视范围内');
    return { img, ratio, url: toJpeg(img, left * ratio, top * ratio, (right - left) * ratio, (bottom - top) * ratio) };
  }
  async function collectImages() {
    const el = q(cfg.answerSel);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) { el.scrollIntoView({ block: r.height > window.innerHeight ? 'start' : 'center' }); await sleep(350); }
    }
    if (el && cfg.imgMode === 'auto') {
      try {
        const out = [];
        const canvases = el.tagName === 'CANVAS' ? [el] : [...el.querySelectorAll('canvas')].filter(c => c.width > 150 && c.height > 60);
        for (const c of canvases) out.push(c.toDataURL('image/jpeg', 0.88));
        const imgs = (el.tagName === 'IMG' ? [el] : [...el.querySelectorAll('img')])
          .filter(i => i.naturalWidth >= 150 && i.naturalHeight >= 60 && i.offsetParent !== null);
        for (const i of imgs) {
          let src = i.currentSrc || i.src;
          if (!src.startsWith('data:')) {
            const resp = await send({ type: 'fetchImage', url: src });
            if (!resp.ok) throw new Error(resp.error);
            src = resp.dataUrl;
          }
          const im = await loadImg(src);
          out.push(toJpeg(im, 0, 0, im.naturalWidth, im.naturalHeight));
        }
        // 背景图
        if (!out.length) {
          const bg = getComputedStyle(el).backgroundImage;
          const m = /url\(["']?(.*?)["']?\)/.exec(bg);
          if (m) { const resp = await send({ type: 'fetchImage', url: new URL(m[1], location.href).href }); if (resp.ok) { const im = await loadImg(resp.dataUrl); out.push(toJpeg(im, 0, 0, im.naturalWidth, im.naturalHeight)); } }
        }
        if (out.length) return out.slice(0, 6);
      } catch (e) { /* 降级截屏 */ }
    }
    const r = regionRect();
    if (!r) throw new Error('还没设置答题区');
    return [(await screenshotRegion(r)).url];
  }

  /* ================= 题目变化检测 ================= */
  function domSig() {
    const el = q(cfg.answerSel);
    if (!el) return '';
    const srcs = [...el.querySelectorAll('img')].map(i => i.currentSrc || i.src).join('|');
    const self = el.tagName === 'IMG' ? el.src : '';
    return srcs + self + '#' + (el.innerText || '').slice(0, 300) + '#' + el.childElementCount;
  }
  async function pixelSig() {
    const r = regionRect(); if (!r) return '';
    try {
      const { img, ratio } = await screenshotRegion(r);
      const c = document.createElement('canvas'); c.width = 24; c.height = 24;
      const g = c.getContext('2d');
      g.drawImage(img, Math.max(0, r.left) * ratio, Math.max(0, r.top) * ratio, r.width * ratio, r.height * ratio, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data; const a = [];
      for (let i = 0; i < d.length; i += 4) a.push((d[i] + d[i + 1] + d[i + 2]) / 3);
      return a;
    } catch (_) { return ''; }
  }
  function pixDiff(a, b) { if (!a || !b || a.length !== b.length) return 999; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; }
  async function waitNext(beforeDom, beforePix, timeout = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (state.stopFlag) return false;
      await sleep(500);
      const d = domSig();
      if (beforeDom && d && d !== beforeDom) { await sleep(400); return true; }
      if (!beforeDom || !d) {
        await sleep(400);
        const p = await pixelSig();
        if (pixDiff(p, beforePix) > 6) { await sleep(300); return true; }
      }
    }
    return false;
  }

  /* ================= 填分 & 提交 ================= */
  function fmtScore(s) { return Number.isInteger(s) ? String(s) : String(+s.toFixed(1)); }
  function normScore(s) {
    const step = Number(cfg.step) || 1, full = Number(cfg.fullScore) || 0;
    let v = Math.round(Number(s) / step) * step;
    return Math.max(0, Math.min(full, +v.toFixed(2)));
  }
  function realClick(el) {
    const r = el.getBoundingClientRect(); const o = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', o)); el.dispatchEvent(new MouseEvent('mousedown', o));
    el.dispatchEvent(new PointerEvent('pointerup', o)); el.dispatchEvent(new MouseEvent('mouseup', o));
    el.click();
  }
  function setValue(el, v) {
    el.focus();
    if (el.isContentEditable) { el.textContent = v; el.dispatchEvent(new InputEvent('input', { bubbles: true })); return; }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function pressEnter(el) {
    const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    (el || document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', o));
    (el || document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keypress', o));
    (el || document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keyup', o));
  }
  function scoreInput() {
    const el = q(cfg.scoreSel); if (!el) return null;
    if (el.matches('input,textarea,[contenteditable="true"]')) return el;
    return el.querySelector('input:not([type=hidden]),textarea,[contenteditable="true"]');
  }
  function fillScore(score) {
    const box = q(cfg.scoreSel);
    if (!box) throw new Error('找不到分数框，请在「页面定位」里重新选择');
    const inp = scoreInput();
    if (inp) { setValue(inp, fmtScore(score)); return inp; }
    const want = [fmtScore(score), score.toFixed(1), fmtScore(score) + '分', fmtScore(score) + ' 分'];
    const cands = [...box.querySelectorAll('button,a,li,span,div,td,label')]
      .filter(n => n.offsetParent !== null && want.includes((n.textContent || '').trim()))
      .sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    if (!cands.length) throw new Error(`分值按钮里找不到「${fmtScore(score)}」`);
    realClick(cands[0]);
    return null;
  }
  async function submit(inp) {
    const mode = cfg.submitMode;
    const btn = q(cfg.submitSel);
    if (mode === 'none') return;
    if ((mode === 'click' || mode === 'auto') && btn) { realClick(btn); return; }
    if (mode === 'click' && !btn) throw new Error('找不到提交按钮，请重新选择');
    pressEnter(inp || scoreInput());
  }

  /* ================= 批改流程 ================= */
  function profile() {
    return { fullScore: Number(cfg.fullScore), step: Number(cfg.step), question: cfg.question, answerRef: cfg.answerRef, rubric: cfg.rubric, extra: cfg.extra };
  }
  function showResult(r, extraHtml = '') {
    const pct = Math.round((r.confidence || 0) * 100);
    setRes(`<div class="sc">${esc(fmtScore(r.score))} <small>/ ${esc(cfg.fullScore)} 分 · 把握 ${pct}%</small></div>
      <div style="margin-top:4px">${esc(r.reason)}</div>
      ${r.recognized ? `<div class="muted" style="margin-top:6px">识别：${esc(r.recognized.slice(0, 160))}</div>` : ''}${extraHtml}`);
  }
  function askConfirm(r, why) {
    return new Promise(resolve => {
      state.confirmResolve = resolve;
      $('confirm').innerHTML = `<div class="cf"><div style="font-weight:600;margin-bottom:6px">${esc(why)}</div>
        <input id="cfv" type="number" step="${cfg.step}" min="0" max="${cfg.fullScore}" value="${fmtScore(r.score)}">
        <div class="ctrl" style="margin:8px 0 0"><button class="btn ok" id="cfok">提交此分</button><button class="btn" id="cfskip">先不提交</button><button class="btn dan" id="cfstop">停止</button></div></div>`;
      const fin = v => { $('confirm').innerHTML = ''; state.confirmResolve = null; resolve(v); };
      $('cfok').onclick = () => fin({ act: 'submit', score: normScore($('cfv').value) });
      $('cfskip').onclick = () => fin({ act: 'skip' });
      $('cfstop').onclick = () => fin({ act: 'stop' });
      $('cfv').onkeydown = e => { if (e.key === 'Enter') $('cfok').click(); };
      $('cfv').focus(); $('cfv').select();
    });
  }

  function checkReady() {
    if (!regionRect()) return '请先在「页面定位」里选择答题区';
    if (!cfg.fullScore) return '请填写本题满分';
    if (!cfg.rubric && !cfg.answerRef) return '请至少填写参考答案或评分标准';
    return '';
  }

  async function gradeCurrent() {
    showScan('AI 正在识别');
    let images;
    try { images = await collectImages(); }
    catch (e) { finishScan('err', esc(e.message), 1500); throw e; }
    showScan('AI 正在阅卷');
    const t0 = Date.now();
    const r = await send({ type: 'grade', images, profile: profile() });
    if (!r.ok) { finishScan('err', '批改失败', 1500); throw new Error(r.error); }
    r.rawScore = r.score;
    r.score = normScore(r.score);
    r.sec = ((Date.now() - t0) / 1000).toFixed(1);
    return r;
  }

  async function tryOne() {
    const err = checkReady(); if (err) return setRes(`<span style="color:#c92a2a">${esc(err)}</span>`);
    if (state.running) return;
    setStatus('试批中');
    try {
      const r = await gradeCurrent();
      const low = r.confidence < Number(cfg.minConf);
      finishScan(low ? 'done warn' : 'done', `${esc(fmtScore(r.score))}<small>/ ${esc(cfg.fullScore)}</small>`, 1600);
      showResult(r, `<div class="muted" style="margin-top:6px">用时 ${r.sec} 秒 · 试批不会提交分数</div>`);
    } catch (e) {
      setRes(`<span style="color:#c92a2a">${esc(e.message)}</span>`);
    }
    setStatus('空闲');
  }

  async function runLoop() {
    const err = checkReady(); if (err) return setRes(`<span style="color:#c92a2a">${esc(err)}</span>`);
    if (state.running) return;
    Object.assign(state, { running: true, paused: false, stopFlag: false, count: 0 });
    $('runCtrl').style.display = ''; $('start').disabled = true; $('one').disabled = true;
    $('pause').textContent = '⏸ 暂停';
    let fails = 0;
    while (!state.stopFlag) {
      while (state.paused && !state.stopFlag) { setStatus('已暂停'); await sleep(300); }
      if (state.stopFlag) break;
      if (cfg.maxCount && state.count >= cfg.maxCount) { setRes(`已达到设定的 ${cfg.maxCount} 题，自动停止。`); break; }
      setStatus(`批改第 ${state.count + 1} 题`);
      const beforeDom = domSig();
      let r;
      try { r = await gradeCurrent(); fails = 0; }
      catch (e) {
        fails++;
        setRes(`<span style="color:#c92a2a">第 ${state.count + 1} 题出错：${esc(e.message)}</span>${fails < 3 ? '<div class="muted">3 秒后重试…</div>' : ''}`);
        if (fails >= 3) { setStatus('出错停止'); break; }
        await sleep(3000); continue;
      }
      if (state.stopFlag) { hideScan(); break; }
      const low = r.confidence < Number(cfg.minConf);
      finishScan(low ? 'done warn' : 'done', `${esc(fmtScore(r.score))}<small>/ ${esc(cfg.fullScore)}</small>`, low || cfg.runMode === 'confirm' ? 60000 : 800);
      showResult(r, `<div class="muted" style="margin-top:6px">用时 ${r.sec} 秒</div>`);
      let finalScore = r.score;
      if (cfg.runMode === 'confirm' || low) {
        setStatus('等待确认');
        const a = await askConfirm(r, low ? `AI 把握只有 ${Math.round(r.confidence * 100)}%，请你确认：` : '确认分数后提交：');
        hideScan();
        if (a.act === 'stop') break;
        if (a.act === 'skip') { state.paused = true; $('pause').textContent = '▶ 继续'; setRes('已暂停。你可以手动处理这题，提交后点「继续」。'); continue; }
        finalScore = a.score;
      }
      const beforePix = beforeDom ? null : await pixelSig();
      try {
        const inp = fillScore(finalScore);
        await sleep(250);
        await submit(inp);
      } catch (e) {
        setRes(`<span style="color:#c92a2a">填分/提交失败：${esc(e.message)}</span>`); setStatus('出错停止'); break;
      }
      state.count++; state.total++;
      state.log.push({ time: new Date().toLocaleString(), score: finalScore, ai: r.score, conf: r.confidence, reason: r.reason, recognized: r.recognized, model: r.model });
      $('cnt').textContent = `已批 ${state.count} 题（本次会话 ${state.total}）`;
      setStatus('等待下一题');
      const moved = await waitNext(beforeDom, beforePix);
      if (state.stopFlag) break;
      if (!moved) { setRes('提交后页面没有切到新题：可能已经批完，或提交方式需要调整。已停止。'); setStatus('已停止'); break; }
      await sleep(Number(cfg.delay) || 0);
    }
    stopRun(true);
  }
  function stopRun(natural) {
    state.stopFlag = true;
    if (state.confirmResolve) state.confirmResolve({ act: 'stop' });
    state.running = false; state.paused = false;
    if (mounted) {
      $('runCtrl').style.display = 'none'; $('start').disabled = false; $('one').disabled = false;
      if (!natural || $('st').textContent.indexOf('出错') < 0) setStatus('空闲');
    }
    hideScan();
  }
  function togglePause() {
    if (!state.running) return runLoop();
    state.paused = !state.paused;
    $('pause').textContent = state.paused ? '▶ 继续' : '⏸ 暂停';
    if (!state.paused) setStatus('继续中');
  }
  $('start').onclick = runLoop;
  $('one').onclick = tryOne;
  $('pause').onclick = togglePause;
  $('stop').onclick = () => { stopRun(); setRes('已停止。'); };

  function exportCsv() {
    if (!state.log.length) return alert('本次还没有批改记录');
    const head = ['时间', '提交分', 'AI分', '把握', '理由', '识别内容', '模型'];
    const rows = state.log.map(l => [l.time, l.score, l.ai, Math.round(l.conf * 100) + '%', l.reason, l.recognized, l.model]);
    const csv = '\ufeff' + [head, ...rows].map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `AI阅卷记录_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  /* ================= 快捷键 & 消息 ================= */
  window.addEventListener('keydown', e => {
    if (!mounted || host.style.display === 'none') return;
    if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); togglePause(); }
    if (e.altKey && (e.key === 'x' || e.key === 'X')) { e.preventDefault(); stopRun(); setRes('已停止。'); }
  }, true);

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg && msg.type === 'showPanel') { loadCfg().then(() => { mount(); host.style.display = ''; renderCfg(); }); sendResponse({ ok: true }); }
  });
  chrome.storage.onChanged.addListener(ch => { if (ch.settings && mounted) renderModel(); });

  loadCfg().then(() => { if (/haofenshu\.com|yunxiao\.com/.test(location.host)) mount(); });
})();
