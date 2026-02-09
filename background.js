// Background Service Worker - Manifest V3

console.log('Web Summarizer background service worker started');

// 初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('Web Summarizer installed');
  initContextMenus();
  initBadge();
});

// 初始化右键菜单
function initContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'ai-summary-root',
      title: 'AI 网页总结',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'view-summary',
      parentId: 'ai-summary-root',
      title: '查看当前页总结',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'resummarize',
      parentId: 'ai-summary-root',
      title: '重新总结当前页',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'clear-summary',
      parentId: 'ai-summary-root',
      title: '清除当前页总结',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'view-history',
      parentId: 'ai-summary-root',
      title: '查看总结历史',
      contexts: ['page']
    });
  });
}

// 初始化Badge
function initBadge() {
  chrome.action.setBadgeBackgroundColor({ color: '#4F46E5' });
  chrome.action.setBadgeText({ text: '' });
}

// 更新Badge
function updateBadge(show, text = '') {
  chrome.action.setBadgeText({ text: show ? text : '' });
}

// 获取存储的总结
async function getSummary(tabId) {
  const result = await chrome.storage.local.get(`summary_${tabId}`);
  return result[`summary_${tabId}`] || null;
}

// 保存总结
async function saveSummary(tabId, data) {
  const key = `summary_${tabId}`;
  const summaries = await chrome.storage.local.get('summaries');
  const summariesMap = summaries.summaries || {};

  summariesMap[key] = {
    ...data,
    timestamp: Date.now()
  };

  // 清理旧数据（保留最近50条）
  const keys = Object.keys(summariesMap);
  if (keys.length > 50) {
    const sortedKeys = keys.sort((a, b) => {
      return summariesMap[b].timestamp - summariesMap[a].timestamp;
    });
    const toDelete = sortedKeys.slice(50);
    toDelete.forEach(k => delete summariesMap[k]);
  }

  await chrome.storage.local.set({
    summaries: summariesMap,
    lastSummaryKey: key
  });

  updateBadge(true, '1');
}

// 清除总结
async function clearSummary(tabId) {
  const key = `summary_${tabId}`;
  const summaries = await chrome.storage.local.get('summaries');
  const summariesMap = summaries.summaries || {};

  if (summariesMap[key]) {
    delete summariesMap[key];
    await chrome.storage.local.set({ summaries: summariesMap });

    // 如果删除的是最后一条，检查是否需要更新badge
    const lastKey = await chrome.storage.local.get('lastSummaryKey');
    if (lastKey.lastSummaryKey === key) {
      const remainingKeys = Object.keys(summariesMap);
      updateBadge(remainingKeys.length > 0, remainingKeys.length > 0 ? String(remainingKeys.length) : '');
    }
  }
}

// 获取所有总结历史
async function getAllSummaries() {
  const result = await chrome.storage.local.get('summaries');
  const summariesMap = result.summaries || {};
  return Object.entries(summariesMap)
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

// 监听右键菜单点击
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;

  switch (info.menuItemId) {
    case 'view-summary':
      const summary = await getSummary(tab.id);
      if (summary) {
        // 发送消息给popup显示总结
        chrome.runtime.sendMessage({
          action: 'showSummary',
          summary: summary,
          tabId: tab.id
        });
        // 打开popup
        chrome.action.openPopup();
      } else {
        // 没有总结，提示用户
        chrome.runtime.sendMessage({
          action: 'noSummary',
          tabId: tab.id
        });
      }
      break;

    case 'resummarize':
      chrome.runtime.sendMessage({
        action: 'startSummarize',
        tabId: tab.id
      });
      chrome.action.openPopup();
      break;

    case 'clear-summary':
      await clearSummary(tab.id);
      chrome.runtime.sendMessage({
        action: 'summaryCleared',
        tabId: tab.id
      });
      break;

    case 'view-history':
      chrome.runtime.sendMessage({
        action: 'showHistory'
      });
      chrome.action.openPopup();
      break;
  }
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'saveSummary':
      saveSummary(request.tabId, request.data);
      sendResponse({ success: true });
      break;

    case 'getSummary':
      getSummary(request.tabId).then(summary => {
        sendResponse({ success: true, summary });
      });
      return true;

    case 'clearSummary':
      clearSummary(request.tabId).then(() => {
        sendResponse({ success: true });
      });
      return true;

    case 'getAllSummaries':
      getAllSummaries().then(summaries => {
        sendResponse({ success: true, summaries });
      });
      return true;

    case 'clearBadge':
      updateBadge(false);
      sendResponse({ success: true });
      break;
  }
});

// 监听标签页更新，清除旧tab的badge
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tabId = activeInfo.tabId;
  const summary = await getSummary(tabId);
  updateBadge(!!summary, summary ? '1' : '');
});

// 监听标签页关闭，清理数据
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = `summary_${tabId}`;
  const summaries = await chrome.storage.local.get('summaries');
  const summariesMap = summaries.summaries || {};

  if (summariesMap[key]) {
    delete summariesMap[key];
    await chrome.storage.local.set({ summaries: summariesMap });
  }
});

console.log('Web Summarizer background service worker initialized');
