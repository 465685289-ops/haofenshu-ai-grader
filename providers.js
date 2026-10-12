// 模型供应商列表。format: openai = OpenAI 兼容接口；anthropic；gemini
// 模型名只是常用预设，下拉里选「自定义」可以填任意模型名 / 接入点 ID。
const PROVIDERS = {
  qwen: {
    name: '阿里云百炼（通义千问）', format: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-vl-max', 'qwen-vl-plus', 'qwen3-vl-plus', 'qwen-vl-ocr'],
    keyUrl: 'https://bailian.console.aliyun.com/'
  },
  doubao: {
    name: '火山方舟（豆包）', format: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-1-6-vision-250815', 'doubao-1-5-vision-pro-32k-250115'],
    note: '也可以直接填推理接入点 ID（ep-xxxx）',
    keyUrl: 'https://console.volcengine.com/ark'
  },
  zhipu: {
    name: '智谱 GLM', format: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.5v', 'glm-4v-plus', 'glm-4v-flash'],
    keyUrl: 'https://open.bigmodel.cn/'
  },
  moonshot: {
    name: '月之暗面 Kimi', format: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k-vision-preview', 'moonshot-v1-32k-vision-preview', 'kimi-latest'],
    keyUrl: 'https://platform.moonshot.cn/'
  },
  hunyuan: {
    name: '腾讯混元', format: 'openai',
    baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: ['hunyuan-vision', 'hunyuan-turbos-vision'],
    keyUrl: 'https://console.cloud.tencent.com/hunyuan'
  },
  qianfan: {
    name: '百度千帆（文心）', format: 'openai',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    models: ['ernie-4.5-turbo-vl-32k', 'ernie-4.5-vl-28b-a3b'],
    keyUrl: 'https://console.bce.baidu.com/qianfan/'
  },
  stepfun: {
    name: '阶跃星辰', format: 'openai',
    baseUrl: 'https://api.stepfun.com/v1',
    models: ['step-1o-turbo-vision', 'step-1v-8k'],
    keyUrl: 'https://platform.stepfun.com/'
  },
  siliconflow: {
    name: '硅基流动 SiliconFlow', format: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['Qwen/Qwen2.5-VL-72B-Instruct', 'Qwen/Qwen2.5-VL-32B-Instruct', 'THUDM/GLM-4.1V-9B-Thinking'],
    keyUrl: 'https://cloud.siliconflow.cn/'
  },
  deepseek: {
    name: 'DeepSeek', format: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat'], textOnly: true,
    note: 'DeepSeek 官方接口目前不支持识图，无法批改扫描答卷',
    keyUrl: 'https://platform.deepseek.com/'
  },
  openai: {
    name: 'OpenAI', format: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-5', 'gpt-5-mini'],
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  anthropic: {
    name: 'Anthropic Claude', format: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'],
    keyUrl: 'https://console.anthropic.com/'
  },
  gemini: {
    name: 'Google Gemini', format: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'],
    keyUrl: 'https://aistudio.google.com/apikey'
  },
  openrouter: {
    name: 'OpenRouter', format: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash', 'qwen/qwen2.5-vl-72b-instruct'],
    keyUrl: 'https://openrouter.ai/keys'
  },
  ollama: {
    name: '本地 Ollama', format: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    models: ['qwen2.5vl:7b', 'llava:13b'], noKey: true,
    note: '本机运行，无需 Key'
  },
  custom: {
    name: '自定义（OpenAI 兼容接口）', format: 'openai',
    baseUrl: '', models: [],
    note: '填写任意 OpenAI 兼容接口地址（以 /v1 结尾）'
  }
};

const DEFAULT_SETTINGS = {
  provider: 'qwen',
  baseUrl: PROVIDERS.qwen.baseUrl,
  model: 'qwen-vl-max',
  apiKey: '',
  temperature: 0.1,
  timeoutSec: 90
};
