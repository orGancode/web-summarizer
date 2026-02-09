// 后台服务脚本
// Manifest V3 使用 service worker

console.log('Web Summarizer background service worker started');

// 安装时初始化
chrome.runtime.onInstalled.addListener(() => {
  console.log('Web Summarizer installed');
  
  // 设置默认配置
  chrome.storage.local.set({
    maxSummaryLength: 500,
    autoSummarize: false,
    language: 'zh-CN'
  });
});

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchSummary') {
    // 可以在这里处理需要跨域的请求
    // 例如调用摘要API
    fetchSummaryFromAPI(request.content)
      .then(summary => sendResponse({ success: true, summary }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道打开
  }
});

// 示例：调用外部API生成摘要
async function fetchSummaryFromAPI(content) {
  // 这里可以接入真实的摘要API，如OpenAI、百度AI等
  // 示例代码：
  /*
  const response = await fetch('https://api.example.com/summarize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer YOUR_API_KEY'
    },
    body: JSON.stringify({
      text: content,
      max_length: 200
    })
  });
  
  const data = await response.json();
  return data.summary;
  */
  
  // 模拟API响应
  return new Promise((resolve) => {
    setTimeout(() => {
      // 简单的摘要逻辑作为示例
      const sentences = content.split(/[。.!?！？]/).filter(s => s.trim());
      const summary = sentences.slice(0, 3).join('。') + '。';
      resolve(summary);
    }, 1000);
  });
}