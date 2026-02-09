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
let currentTabId = null;
let isViewingHistory = false;
let summarizeProgress = null;  // 总结进度状态

async function loadConfig() {
  const stored = await chrome.storage.sync.get(['aiConfig']);
  if (stored.aiConfig) {
    Object.assign(CONFIG, stored.aiConfig);
  }
}

// ===== Storage Functions =====
async function getCurrentTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;
  return tab.id;
}

async function saveSummaryToStorage(data) {
  const tabId = await getCurrentTabId();
  await chrome.runtime.sendMessage({
    action: 'saveSummary',
    tabId: tabId,
    data: {
      url: data.url,
      title: data.title,
      original: data.original,
      chinese: data.chinese,
      detectedLanguage: data.detectedLanguage
    }
  });
}

// ===== Progress State =====
async function saveProgressState(state) {
  const tabId = await getCurrentTabId();
  const progressKey = `progress_${tabId}`;
  await chrome.storage.local.set({
    [progressKey]: {
      ...state,
      timestamp: Date.now()
    }
  });
}

async function getProgressState() {
  const tabId = await getCurrentTabId();
  const progressKey = `progress_${tabId}`;
  const result = await chrome.storage.local.get(progressKey);
  const progress = result[progressKey];

  if (progress) {
    // 检查是否过期（超过5分钟）
    if (Date.now() - progress.timestamp > 5 * 60 * 1000) {
      await clearProgressState();
      return null;
    }
  }
  return progress || null;
}

async function clearProgressState() {
  const tabId = await getCurrentTabId();
  const progressKey = `progress_${tabId}`;
  await chrome.storage.local.remove(progressKey);
}

async function loadSummaryFromStorage() {
  const tabId = await getCurrentTabId();
  const response = await chrome.runtime.sendMessage({
    action: 'getSummary',
    tabId: tabId
  });
  if (response.success && response.summary) {
    return response.summary;
  }
  return null;
}

async function clearSummaryFromStorage() {
  const tabId = await getCurrentTabId();
  await chrome.runtime.sendMessage({
    action: 'clearSummary',
    tabId: tabId
  });
}

async function loadAllSummaries() {
  const response = await chrome.runtime.sendMessage({ action: 'getAllSummaries' });
  if (response.success) {
    return response.summaries;
  }
  return [];
}

// ===== Message Listener =====
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'showSummary':
      if (request.summary) {
        displaySummary(request.summary);
        clearBadge();
      }
      break;

    case 'noSummary':
      showNoSummaryMessage();
      break;

    case 'summaryCleared':
      showClearedMessage();
      break;
  }
});

function clearBadge() {
  chrome.runtime.sendMessage({ action: 'clearBadge' });
}

function displaySummary(summary) {
  const resultEl = document.getElementById('result');
  const errorEl = document.getElementById('error');
  const copyBtn = document.getElementById('copyBtn');

  errorEl.classList.add('hidden');

  bilingualSummary = {
    original: { content: summary.original },
    chinese: summary.chinese,
    detectedLanguage: summary.detectedLanguage || 'zh'
  };

  const tabBar = document.getElementById('tabBar');
  const tabs = tabBar.querySelectorAll('.tab-btn');

  if (summary.detectedLanguage && summary.detectedLanguage !== 'zh') {
    tabBar.style.display = 'flex';
    tabs[0].textContent = LANGUAGE_NAMES[summary.detectedLanguage] || summary.detectedLanguage;
    tabs[1].textContent = '中文';
    tabs[0].classList.add('active');
    tabs[1].classList.remove('active');
    renderMarkdown(summary.original);
  } else {
    tabBar.style.display = 'none';
    renderMarkdown(summary.original);
  }

  if (summary.chinese) {
    bilingualSummary.chinese = { content: summary.chinese };
  }

  resultEl.classList.remove('hidden');
  copyBtn.classList.remove('hidden');
  document.getElementById('statusText').textContent = '已加载缓存总结';

  if (summary.timestamp) {
    const date = new Date(summary.timestamp);
    document.getElementById('timeCost').textContent = date.toLocaleString('zh-CN');
  }
}

function showNoSummaryMessage() {
  const errorEl = document.getElementById('error');
  errorEl.classList.remove('hidden');
  document.getElementById('errorText').textContent = '当前页面还没有总结记录，点击"总结"按钮生成。';
  document.getElementById('statusText').textContent = '无总结记录';
}

function showClearedMessage() {
  const errorEl = document.getElementById('error');
  errorEl.classList.remove('hidden');
  document.getElementById('errorText').textContent = '已清除当前页面的总结记录。';
  document.getElementById('statusText').textContent = '已清除';
}

async function initPopup() {
  await getCurrentTabId();

  // 先检查是否有正在进行的总结进度
  const progress = await getProgressState();
  if (progress && progress.status) {
    restoreProgressState(progress);
    return;
  }

  // 没有进度，显示已保存的总结
  const savedSummary = await loadSummaryFromStorage();
  if (savedSummary) {
    displaySummary(savedSummary);
  }
}

function restoreProgressState(progress) {
  const btn = document.getElementById('summarizeBtn');
  const statusEl = document.getElementById('status');
  const spinner = document.querySelector('.loading-spinner');
  const statusText = document.getElementById('statusText');
  const resultEl = document.getElementById('result');
  const errorEl = document.getElementById('error');
  const copyBtn = document.getElementById('copyBtn');

  // 如果有pageData，恢复总结流程
  if (progress.status === 'summarizing' && progress.pageData) {
    isSummarizing = true;
    abortController = new AbortController();
    btn.textContent = '停止';

    statusEl.classList.add('loading');
    spinner.classList.remove('hidden');
    statusText.textContent = progress.statusText;
    errorEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    copyBtn.classList.add('hidden');

    // 继续总结流程
    continueSummarization(progress.pageData);
  } else {
    // 提取阶段，恢复UI状态
    isSummarizing = true;
    abortController = new AbortController();
    btn.textContent = '停止';

    statusEl.classList.add('loading');
    spinner.classList.remove('hidden');
    statusText.textContent = progress.statusText;
  }
}

async function continueSummarization(pageData) {
  const btn = document.getElementById('summarizeBtn');
  const statusEl = document.getElementById('status');
  const spinner = document.querySelector('.loading-spinner');
  const statusText = document.getElementById('statusText');
  const resultEl = document.getElementById('result');
  const errorEl = document.getElementById('error');
  const copyBtn = document.getElementById('copyBtn');

  try {
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

    statusText.textContent = '总结完成';

    // 清除进度并保存总结
    await clearProgressState();
    await saveSummaryToStorage({
      url: pageData.url,
      title: pageData.title,
      original: result.content,
      chinese: null,
      detectedLanguage: detectedLang
    });

  } catch (err) {
    await clearProgressState();
    if (err.name === 'AbortError') {
      statusText.textContent = '已停止';
      btn.textContent = '总结';
      isSummarizing = false;
      return;
    }
    console.error(err);
    errorEl.classList.remove('hidden');
    document.getElementById('errorText').textContent = err.message;
    statusText.textContent = '出错了';
  } finally {
    isSummarizing = false;
    btn.textContent = '总结';
    statusEl.classList.remove('loading');
    spinner.classList.add('hidden');
    abortController = null;
  }
}

// ===== History Modal =====
async function showHistory() {
  const modal = document.getElementById('historyModal');
  const historyList = document.getElementById('historyList');

  modal.classList.remove('hidden');
  historyList.innerHTML = '<div class="history-empty">加载中...</div>';

  const summaries = await loadAllSummaries();

  if (summaries.length === 0) {
    historyList.innerHTML = '<div class="history-empty">暂无总结历史</div>';
    return;
  }

  historyList.innerHTML = summaries.slice(0, 20).map(item => {
    const date = new Date(item.timestamp);
    const url = new URL(item.url);
    const title = item.title || url.hostname;
    const lang = LANGUAGE_NAMES[item.detectedLanguage] || '原文';

    return `
      <div class="history-item" data-key="${item.key}">
        <div class="history-item-title">${escapeHtml(title)}</div>
        <div class="history-item-meta">
          <span>${lang}</span>
          <span>${date.toLocaleDateString('zh-CN')} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  historyList.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.key;
      const summary = summaries.find(s => s.key === key);
      if (summary) {
        displaySummary(summary);
        modal.classList.add('hidden');
      }
    });
  });
}

function hideHistory() {
  document.getElementById('historyModal').classList.add('hidden');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
    signal: abortController && abortController.signal
  });

  if (!response.ok) {
    const error = await response.json();
    const errorMsg = (error.error && error.error.message) || '未知错误';
    throw new Error(`${provider} API 错误: ${errorMsg}`);
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
    signal: abortController && abortController.signal
  });

  if (!response.ok) {
    const error = await response.json();
    const errorMsg = (error.error && error.error.message) || '未知错误';
    throw new Error(`翻译失败: ${errorMsg}`);
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

  // 保存翻译进度
  await saveProgressState({
    status: 'translating',
    statusText: '正在翻译...',
    summary: bilingualSummary
  });

  try {
    bilingualSummary.chinese = await translateToChinese(bilingualSummary.original.content);
    renderMarkdown(bilingualSummary.chinese);
    currentTab = 'chinese';

    // 清除翻译进度
    await clearProgressState();

    if (bilingualSummary.original.usage) {
      const total = (bilingualSummary.original.usage.total_tokens || 0) * 2;
      document.getElementById('tokenCount').textContent = `Token: ~${total}`;
    }

    // 保存中文翻译到storage
    await saveSummaryToStorage({
      url: '',
      title: '',
      original: bilingualSummary.original.content,
      chinese: bilingualSummary.chinese,
      detectedLanguage: bilingualSummary.detectedLanguage
    });
  } catch (err) {
    await clearProgressState();
    console.error(err);
    statusText.textContent = '翻译失败';
  } finally {
    isTranslating = false;
    statusEl.classList.remove('loading');
    spinner.classList.add('hidden');
  }
}

let isSummarizing = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await initPopup();

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

    // 保存进度状态
    await saveProgressState({
      status: 'extracting',
      statusText: '正在提取页面内容...'
    });

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
        await clearProgressState();
        throw new Error('页面内容太少，无法总结');
      }

      // 保存进度
      await saveProgressState({
        status: 'summarizing',
        statusText: '正在生成总结...',
        pageData: pageData
      });

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

      // 清除进度状态
      await clearProgressState();

      // 保存到storage
      await saveSummaryToStorage({
        url: pageData.url,
        title: pageData.title,
        original: result.content,
        chinese: null,
        detectedLanguage: detectedLang
      });

    } catch (err) {
      await clearProgressState();
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
      btn.textContent = '总结';
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

  document.getElementById('historyBtn').addEventListener('click', showHistory);

  document.getElementById('closeHistoryBtn').addEventListener('click', hideHistory);

  document.getElementById('historyModal').addEventListener('click', (e) => {
    if (e.target.id === 'historyModal') {
      hideHistory();
    }
  });
});
