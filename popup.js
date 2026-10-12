(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  const p = PROVIDERS[s.provider] || PROVIDERS.custom;
  document.getElementById('model').textContent =
    (s.apiKey || p.noKey) ? `当前：${p.name} · ${s.model}` : '还没有填写 API Key，请先去设置';
})();

document.getElementById('opt').onclick = () => chrome.runtime.openOptionsPage();
document.getElementById('open').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'showPanel' });
    window.close();
  } catch (e) {
    document.getElementById('err').textContent = '无法在此页面运行：' + e.message;
  }
};
