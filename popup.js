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

// 存储双语言总结结果
let bilingualSummary = {
  original: null,
  chinese: null,
  detectedLanguage: 'zh'
};

// 加载用户配置
async function loadConfig() {
  const stored = await chrome.storage.sync.get(['aiConfig']);
  if (stored.aiConfig) {
    Object.assign(CONFIG, stored.aiConfig);
  }
}

// ===== 内容提取 =====
async function extractPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // 检查是否是允许的页面
  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('edge://')) {
    throw new Error('无法在此页面运行（浏览器内部页面）');
  }
  
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { action: 'extract' }, async (response) => {
      if (chrome.runtime.lastError) {
        // Content script 未加载，尝试动态注入
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          
          // 注入成功后再次发送消息
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

// ===== AI API 调用 =====
async function callAI(content, title, url) {
  const { provider, apiKeys, models } = CONFIG;
  const apiKey = apiKeys[provider];
  
  if (!apiKey) {
    throw new Error('请先设置 API Key（点击右上角 ⚙️）');
  }

  // 检测语言
  const detectedLanguage = detectLanguage(content, title);
  bilingualSummary.detectedLanguage = detectedLanguage;
  
  // 生成原语种总结
  const originalPrompt = buildPrompt(content, title, url, detectedLanguage);
  const originalResponse = await callAIProvider(originalPrompt, apiKey, models[provider], provider);
  bilingualSummary.original = originalResponse;
  
  // 如果不是中文，生成中文翻译
  if (detectedLanguage !== 'zh') {
    const chinesePrompt = buildTranslationPrompt(originalResponse.content);
    const chineseResponse = await callAIProvider(chinesePrompt, apiKey, models[provider], provider);
    bilingualSummary.chinese = chineseResponse;
  } else {
    bilingualSummary.chinese = null;
  }
  
  return bilingualSummary;
}

// 调用具体的 AI 提供商
async function callAIProvider(prompt, apiKey, model, provider) {
  switch (provider) {
    case 'zhipu':
      return callZhipu(prompt, apiKey, model);
    case 'openai':
      return callOpenAI(prompt, apiKey, model);
    case 'deepseek':
      return callDeepSeek(prompt, apiKey, model);
    default:
      throw new Error('未知的 AI 提供商');
  }
}

// 检测文本语言
function detectLanguage(content, title) {
  const text = (title + ' ' + content).substring(0, 500);
  
  // 简单的中文检测
  const chineseRegex = /[\u4e00-\u9fa5]/;
  const chineseMatches = text.match(chineseRegex);
  const chineseRatio = chineseMatches ? chineseMatches.length / text.length : 0;
  
  // 如果中文字符占比超过 30%，认为是中文
  if (chineseRatio > 0.3) {
    return 'zh';
  }
  
  // 检测其他语言
  const englishRegex = /[a-zA-Z]/;
  const englishMatches = text.match(englishRegex);
  const englishRatio = englishMatches ? englishMatches.length / text.length : 0;
  
  if (englishRatio > 0.5) {
    return 'en';
  }
  
  // 默认返回英文
  return 'en';
}

// 构建优化后的 Prompt
function buildPrompt(content, title, url, language = 'zh') {
  const isChinese = language === 'zh';
  const outputLang = isChinese ? '中文' : '英文';
  
  return `你是一位资深的内容分析师，擅长将复杂信息转化为简洁易懂的总结。

【任务】
请对以下网页内容进行深度分析和总结，帮助读者快速抓住核心价值。

【网页信息】
标题：${title}
链接：${url}

【网页内容】
"""
${content}
"""

【输出要求】
请严格按照以下 Markdown 格式输出，保持专业且有趣的风格：

## 📌 一句话总结
用 1 句话（不超过 ${isChinese ? '50 字' : '20 words'}）精准概括文章核心价值。

## 🎯 核心观点
用 2-3 句话阐述文章的核心论点或主要发现，逻辑清晰，重点突出。

## 🔑 关键要点
提取 3-5 个最重要的信息点，每个要点用 1 句话表达：
- 要点 1
- 要点 2
- 要点 3

## 💡 实用建议
如果内容包含可操作的建议，列出 1-2 条具体可行的建议。如果没有，请省略此部分。

## 🤔 延伸思考
提出 1 个引人深思的问题，激发读者进一步思考。

【风格指南】
- 使用${outputLang}输出
- 语言简洁有力，避免冗长表述
- 使用生动的比喻或类比增强可读性
- 保持客观中立，不添加主观评价
- 适当使用 emoji 增加趣味性
- 如果内容是错误页面、广告或无意义内容，请直接回复"⚠️ 此页面内容不适合总结"

现在开始分析并输出总结：`;
}

// 构建翻译 Prompt
function buildTranslationPrompt(originalSummary) {
  return `请将以下总结内容翻译成中文，保持原有的 Markdown 格式和 emoji 表情符号：

${originalSummary}

要求：
- 保持原有的结构和格式
- 保持 emoji 表情符号
- 翻译要准确、自然、流畅
- 保持专业且有趣的风格`;
}

// 智谱 AI 调用
async function callZhipu(prompt, apiKey, model) {
  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: '你是一个专业的内容总结助手，擅长提取关键信息并用简洁的语言表达。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1500
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`智谱 API 错误: ${error.error?.message || '未知错误'}`);
  }
  
  const data = await response.json();
  return {
    content: data.choices[0].message.content,
    usage: data.usage
  };
}

// OpenAI 调用（类似结构）
async function callOpenAI(prompt, apiKey, model) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that summarizes web content.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1500
    })
  });
  
  // 错误处理...
  const data = await response.json();
  return {
    content: data.choices[0].message.content,
    usage: data.usage
  };
}

// DeepSeek 调用
async function callDeepSeek(prompt, apiKey, model) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: '你是一个专业的内容总结助手。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1500
    })
  });
  
  const data = await response.json();
  return {
    content: data.choices[0].message.content,
    usage: data.usage
  };
}

// ===== UI 渲染 =====
function renderResult(bilingualData) {
  const { original, chinese, detectedLanguage } = bilingualData;
  
  // 显示或隐藏 tab 切换组件
  const tabContainer = document.getElementById('tabContainer');
  if (detectedLanguage !== 'zh' && chinese) {
    tabContainer.classList.remove('hidden');
    // 设置 tab 标签
    const originalTab = document.getElementById('originalTab');
    const chineseTab = document.getElementById('chineseTab');
    
    if (detectedLanguage === 'en') {
      originalTab.textContent = '🇺🇸 English';
      chineseTab.textContent = '🇨🇳 中文';
    } else {
      originalTab.textContent = '🌐 原文';
      chineseTab.textContent = '🇨🇳 中文';
    }
    
    // 默认显示原语种
    renderSummaryContent(original.content);
    setActiveTab('original');
  } else {
    tabContainer.classList.add('hidden');
    renderSummaryContent(original.content);
  }
  
  // 显示元信息
  if (original.usage) {
    document.getElementById('tokenCount').textContent = 
      `Token: ${original.usage.total_tokens}`;
  }
  
  // 显示结果区域
  document.getElementById('result').classList.remove('hidden');
  document.getElementById('copyBtn').classList.remove('hidden');
}

// 渲染总结内容
function renderSummaryContent(content) {
  // 解析 Markdown 结构
  const sections = parseMarkdownSections(content);
  
  // 渲染一句话总结
  const oneLineSummary = sections['一句话总结'] || sections['📌 一句话总结'] || sections['One-line Summary'] || '';
  const oneLineSection = document.getElementById('oneLineSection');
  const oneLineEl = document.getElementById('oneLineSummary');
  if (oneLineSummary && oneLineSection && oneLineEl) {
    oneLineEl.textContent = oneLineSummary;
    oneLineSection.classList.remove('hidden');
  } else if (oneLineSection) {
    oneLineSection.classList.add('hidden');
  }
  
  // 渲染核心观点
  document.getElementById('summaryText').textContent = 
    sections['核心观点'] || sections['🎯 核心观点'] || sections['Core Points'] || '未找到总结';
  
  // 渲染关键要点
  const keyPointsList = document.getElementById('keyPointsList');
  keyPointsList.innerHTML = '';
  const points = sections['关键要点'] || sections['🔑 关键要点'] || sections['Key Points'] || '';
  points.split('\n').forEach(line => {
    const match = line.match(/^[-*]\s*(.+)/);
    if (match) {
      const li = document.createElement('li');
      li.textContent = match[1];
      keyPointsList.appendChild(li);
    }
  });
  
  // 渲染实用建议（如果有）
  const practicalTips = sections['实用建议'] || sections['💡 实用建议'] || sections['Practical Tips'] || '';
  const tipsSection = document.getElementById('tipsSection');
  const tipsEl = document.getElementById('practicalTips');
  if (practicalTips && tipsSection && tipsEl) {
    tipsEl.innerHTML = '';
    practicalTips.split('\n').forEach(line => {
      const match = line.match(/^[-*]\s*(.+)/);
      if (match) {
        const li = document.createElement('li');
        li.textContent = match[1];
        tipsEl.appendChild(li);
      }
    });
    tipsSection.classList.remove('hidden');
  } else if (tipsSection) {
    tipsSection.classList.add('hidden');
  }
  
  // 渲染延伸思考（如果有）
  const deepThinking = sections['延伸思考'] || sections['🤔 延伸思考'] || sections['Deep Thinking'] || '';
  const thinkingSection = document.getElementById('thinkingSection');
  const thinkingEl = document.getElementById('deepThinking');
  if (deepThinking && thinkingSection && thinkingEl) {
    thinkingEl.textContent = deepThinking;
    thinkingSection.classList.remove('hidden');
  } else if (thinkingSection) {
    thinkingSection.classList.add('hidden');
  }
}

// 设置激活的 tab
function setActiveTab(tab) {
  const originalTab = document.getElementById('originalTab');
  const chineseTab = document.getElementById('chineseTab');
  
  if (tab === 'original') {
    originalTab.classList.add('active');
    chineseTab.classList.remove('active');
  } else {
    chineseTab.classList.add('active');
    originalTab.classList.remove('active');
  }
}

// 简单的 Markdown 分块解析
function parseMarkdownSections(markdown) {
  const sections = {};
  const lines = markdown.split('\n');
  let currentSection = null;
  let currentContent = [];
  
  lines.forEach(line => {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      if (currentSection) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      currentSection = headerMatch[1].trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  });
  
  if (currentSection) {
    sections[currentSection] = currentContent.join('\n').trim();
  }
  
  return sections;
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  
  // 总结按钮
  document.getElementById('summarizeBtn').addEventListener('click', async () => {
    const statusEl = document.getElementById('status');
    const statusText = document.getElementById('statusText');
    const spinner = document.querySelector('.loading-spinner');
    const resultEl = document.getElementById('result');
    const errorEl = document.getElementById('error');
    
    try {
      // UI 状态：加载中
      statusEl.classList.add('loading');
      spinner.classList.remove('hidden');
      statusText.textContent = '正在提取页面内容...';
      resultEl.classList.add('hidden');
      errorEl.classList.add('hidden');
      
      // 1. 提取内容
      const startTime = Date.now();
      const pageData = await extractPageContent();
      
      if (pageData.length < 100) {
        throw new Error('页面内容太少，无法总结（可能是首页或列表页）');
      }
      
      statusText.textContent = '正在生成总结...';
      
      // 2. 调用 AI
      const aiResponse = await callAI(pageData.content, pageData.title, pageData.url);
      
      // 3. 渲染结果
      renderResult(aiResponse);
      
      const timeCost = ((Date.now() - startTime) / 1000).toFixed(1);
      document.getElementById('timeCost').textContent = `${timeCost}s`;
      
      statusText.textContent = '总结完成';
      
    } catch (err) {
      console.error(err);
      errorEl.classList.remove('hidden');
      document.getElementById('errorText').textContent = err.message;
      statusText.textContent = '出错了';
    } finally {
      statusEl.classList.remove('loading');
      spinner.classList.add('hidden');
    }
  });
  
  // 复制按钮
  document.getElementById('copyBtn').addEventListener('click', async () => {
    let text = '';
    
    // 一句话总结
    const oneLineSummary = document.getElementById('oneLineSummary');
    if (oneLineSummary && !oneLineSummary.classList.contains('hidden')) {
      text += `📌 ${oneLineSummary.textContent}\n\n`;
    }
    
    // 核心观点
    const summary = document.getElementById('summaryText').textContent;
    text += `🎯 核心观点\n${summary}\n\n`;
    
    // 关键要点
    const points = Array.from(document.querySelectorAll('#keyPointsList li'))
      .map(li => `- ${li.textContent}`).join('\n');
    text += `🔑 关键要点\n${points}\n`;
    
    // 实用建议
    const tipsSection = document.getElementById('tipsSection');
    if (tipsSection && !tipsSection.classList.contains('hidden')) {
      const tips = Array.from(document.querySelectorAll('#practicalTips li'))
        .map(li => `- ${li.textContent}`).join('\n');
      text += `\n💡 实用建议\n${tips}\n`;
    }
    
    // 延伸思考
    const thinkingSection = document.getElementById('thinkingSection');
    if (thinkingSection && !thinkingSection.classList.contains('hidden')) {
      const thinking = document.getElementById('deepThinking').textContent;
      text += `\n🤔 延伸思考\n${thinking}`;
    }
    
    await navigator.clipboard.writeText(text);
    
    const btn = document.getElementById('copyBtn');
    const originalText = btn.textContent;
    btn.textContent = '✅ 已复制';
    setTimeout(() => btn.textContent = originalText, 2000);
  });
  
  // 设置按钮
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  // 重试按钮
  document.getElementById('retryBtn').addEventListener('click', () => {
    document.getElementById('summarizeBtn').click();
  });
  
  // Tab 切换 - 原语种
  document.getElementById('originalTab').addEventListener('click', () => {
    if (bilingualSummary.original) {
      renderSummaryContent(bilingualSummary.original.content);
      setActiveTab('original');
    }
  });
  
  // Tab 切换 - 中文
  document.getElementById('chineseTab').addEventListener('click', () => {
    if (bilingualSummary.chinese) {
      renderSummaryContent(bilingualSummary.chinese.content);
      setActiveTab('chinese');
    }
  });
});