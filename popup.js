// popup.js

// ===== 配置管理 =====
const CONFIG = {
  // 默认使用智谱 AI（国内访问稳定）
  provider: 'deepseek',
  apiKeys: {
    openai: '',
    zhipu: '',
    deepseek: ''
  },
  models: {
    openai: 'gpt-3.5-turbo',
    zhipu: 'glm-4-flash',        // 免费且快速
    deepseek: 'deepseek-chat'
  }
};

let bilingualSummary = { original: null, chinese: null, detectedLanguage: 'zh' };
let isTranslating = false;
let currentTab = 'original';
let abortController = null;

async function loadConfig() {
  const stored = await chrome.storage.sync.get(['aiConfig']);
  if (stored.aiConfig) {
    Object.assign(CONFIG, stored.aiConfig);
  }
}

async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
    throw new Error('无法在此页面运行（浏览器内部页面）');
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { action: 'extract' }, async (response) => {
      if (chrome.runtime.lastError) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });

          chrome.tabs.sendMessage(tab.id, { action: 'extract' }, (response2) => {
            if (chrome.runtime.lastError) {
              reject(new Error('无法访问页面内容，请刷新页面后重试'));
              return;
            }
            if (response2 && response2.success) {
              resolve(response2);
            } else {
              reject(new Error('内容提取失败'));
            }
          });
        } catch (injectError) {
          reject(new Error('无法访问页面内容，请刷新页面后重试'));
        }
        return;
      }
      if (response && response.success) {
        resolve(response);
      } else {
        reject(new Error('内容提取失败'));
      }
    });
  });
}

const LANGUAGE_NAMES = {
  'zh': '中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어'
};

function detectLanguage(content) {
  const chineseChars = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
  const japaneseChars = (content.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || []).length;
  const koreanChars = (content.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) || []).length;
  const totalChars = content.length;

  const chineseRatio = chineseChars / totalChars;
  const japaneseRatio = japaneseChars / totalChars;
  const koreanRatio = koreanChars / totalChars;

  if (chineseRatio > 0.1) return 'zh';
  if (japaneseRatio > 0.1) return 'ja';
  if (koreanRatio > 0.1) return 'ko';
  return 'en';
}

async function summarize(content, title, url, language) {
  const { provider, apiKeys, models } = CONFIG;
  const apiKey = apiKeys[provider];

  if (!apiKey) {
    throw new Error('请先设置 API Key（点击右上角设置按钮）');
  }

  const isChinese = language === 'zh';
  const nativeLang = LANGUAGE_NAMES[language] || '原文语言';
  const wordLimit = isChinese ? '50 字' : '20 words';
  const prompt = `You are a professional content analyst. Analyze and summarize the following web content in ${nativeLang}.

【Task】
Analyze and summarize the web content below to help readers quickly grasp the core value.

【Web Info】
Title: ${title}
URL: ${url}

【Content】
"""
${content}
"""

【Output Format】
Use the following Markdown format:

## 📌 One-sentence Summary
In 1 sentence (no more than ${wordLimit}), summarize the core value of the article.

## 🎯 Key viewpoints
In 2-3 sentences, explain the main arguments or findings.

## 🔑 Key Points
Extract 3-5 most important points, each in 1 sentence:
- Point 1
- Point 2
- Point 3

## 💡 Practical Suggestions
List 1-2 actionable suggestions if applicable. Skip if not applicable.

## 🤔 Extended Thinking
Pose 1 thought-provoking question.

【Style Guide】
- Output in ${nativeLang}
- Keep language concise and powerful
- Use vivid metaphors or analogies
- Stay objective and neutral
- Use emojis appropriately
- If content is an error page, ad, or meaningless, reply: "⚠️ This page is not suitable for summarization"

Now analyze and output the summary in ${nativeLang}:`;

  const endpoints = {
    zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions'
  };

  const systemMessages = {
    zhipu: language === 'en' ? 'You are a helpful assistant that summarizes web content.' : '你是一个专业的内容总结助手。',
    openai: 'You are a helpful assistant that summarizes web content.',
    deepseek: language === 'en' ? 'You are a helpful assistant that summarizes web content.' : '你是一个专业的内容总结助手。'
  };

  const response = await fetch(endpoints[provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: models[provider],
      messages: [
        { role: 'system', content: systemMessages[provider] },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1500
    }),
    signal: abortController?.signal
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`${provider} API 错误: ${error.error?.message || '未知错误'}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0].message.content,
    usage: data.usage
  };
}

async function translateToChinese(summaryContent) {
  const { provider, apiKeys, models } = CONFIG;
  const apiKey = apiKeys[provider];

  const prompt = `请将以下总结内容翻译成中文，保留 Markdown 格式：

${summaryContent}`;

  const endpoints = {
    zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    openai: 'https://api.openai.com/v1/chat/completions',
    deepseek: 'https://api.deepseek.com/chat/completions'
  };

  const response = await fetch(endpoints[provider], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: models[provider],
      messages: [
        { role: 'system', content: '你是一个专业的内容翻译助手。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1500
    }),
    signal: abortController?.signal
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`翻译失败: ${error.error?.message || '未知错误'}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function renderMarkdown(content) {
  const html = marked.parse(content);
  document.getElementById('markdownContent').innerHTML = html;
}

async function switchToChinese() {
  if (isTranslating || bilingualSummary.chinese) return;

  const statusText = document.getElementById('statusText');
  const spinner = document.querySelector('.loading-spinner');
  const statusEl = document.getElementById('status');

  isTranslating = true;
  statusEl.classList.add('loading');
  spinner.classList.remove('hidden');
  statusText.textContent = '正在翻译...';

  try {
    bilingualSummary.chinese = await translateToChinese(bilingualSummary.original.content);
    renderMarkdown(bilingualSummary.chinese);
    currentTab = 'chinese';

    if (bilingualSummary.original.usage) {
      const total = (bilingualSummary.original.usage.total_tokens || 0) * 2;
      document.getElementById('tokenCount').textContent = `Token: ~${total}`;
    }
  } catch (err) {
    console.error(err);
    statusText.textContent = '翻译失败';
  } finally {
    isTranslating = false;
    statusEl.classList.remove('loading');
    spinner.classList.add('hidden');
  }
}

let isSummarizing = false;

document.addEventListener('DOMContentLoaded', () => {
  loadConfig();

  document.getElementById('summarizeBtn').addEventListener('click', async () => {
    const btn = document.getElementById('summarizeBtn');
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const spinner = document.querySelector('.loading-spinner');
    const resultEl = document.getElementById('result');
    const errorEl = document.getElementById('error');
    const copyBtn = document.getElementById('copyBtn');

    if (isSummarizing) {
      if (confirm('确定要停止总结任务吗？')) {
        if (abortController) {
          abortController.abort();
        }
        isSummarizing = false;
        btn.textContent = '总结';
        statusText.textContent = '已停止';
        statusEl.classList.remove('loading');
        spinner.classList.add('hidden');
      }
      return;
    }

    isSummarizing = true;
    abortController = new AbortController();
    btn.textContent = '停止';

    try {
      statusEl.classList.add('loading');
      spinner.classList.remove('hidden');
      statusText.textContent = '正在提取页面内容...';
      resultEl.classList.add('hidden');
      errorEl.classList.add('hidden');
      copyBtn.classList.add('hidden');
      document.getElementById('tokenCount').textContent = '';

      const startTime = Date.now();
      const pageData = await extractPageContent();

      if (pageData.length < 100) {
        throw new Error('页面内容太少，无法总结');
      }

      statusText.textContent = '正在生成总结...';

      const detectedLang = detectLanguage(pageData.content);
      const result = await summarize(pageData.content, pageData.title, pageData.url, detectedLang);

      bilingualSummary = {
        original: result,
        chinese: null,
        detectedLanguage: detectedLang
      };

      const tabBar = document.getElementById('tabBar');
      const tabs = tabBar.querySelectorAll('.tab-btn');

      if (detectedLang !== 'zh') {
        tabBar.style.display = 'flex';
        tabs[0].textContent = LANGUAGE_NAMES[detectedLang] || detectedLang;
        tabs[1].textContent = '中文';
        tabs[0].classList.add('active');
        tabs[1].classList.remove('active');
      } else {
        tabBar.style.display = 'none';
      }

      renderMarkdown(result.content);

      if (result.usage) {
        document.getElementById('tokenCount').textContent = `Token: ${result.usage.total_tokens}`;
      }

      resultEl.classList.remove('hidden');
      copyBtn.classList.remove('hidden');

      const timeCost = ((Date.now() - startTime) / 1000).toFixed(1);
      document.getElementById('timeCost').textContent = `${timeCost}s`;

      statusText.textContent = '总结完成';

    } catch (err) {
      if (err.name === 'AbortError') {
        statusText.textContent = '已停止';
        return;
      }
      console.error(err);
      errorEl.classList.remove('hidden');
      document.getElementById('errorText').textContent = err.message;
      statusText.textContent = '出错了';
    } finally {
      isSummarizing = false;
      if (abortController?.signal.aborted) {
        btn.textContent = '总结';
      } else {
        btn.textContent = '总结';
      }
      statusEl.classList.remove('loading');
      spinner.classList.add('hidden');
      abortController = null;
    }
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tab = btn.dataset.tab;

      if (tab === 'chinese') {
        await switchToChinese();
      } else {
        renderMarkdown(bilingualSummary.original.content);
      }

      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.getElementById('copyBtn').addEventListener('click', async () => {
    const activeTab = document.querySelector('.tab-btn.active');
    const isChinese = activeTab && activeTab.dataset.tab === 'chinese';
    const content = isChinese && bilingualSummary.chinese
      ? bilingualSummary.chinese
      : bilingualSummary.original.content;

    await navigator.clipboard.writeText(content);

    const btn = document.getElementById('copyBtn');
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> 已复制`;
    setTimeout(() => {
      btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制结果`;
    }, 2000);
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('retryBtn').addEventListener('click', () => {
    document.getElementById('summarizeBtn').click();
  });
});
