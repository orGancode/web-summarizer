// 内容脚本 - 在页面中运行
// 可以在这里添加页面内容提取和处理的逻辑

console.log('Web Summarizer content script loaded');

// 监听来自popup或background的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    const content = extractPageContent();
    sendResponse({ content });
  }
  return true;
});

function extractPageContent() {
  // 尝试提取文章主要内容
  const selectors = [
    'article',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.entry-content',
    'main'
  ];
  
  let contentElement = null;
  
  for (const selector of selectors) {
    contentElement = document.querySelector(selector);
    if (contentElement) break;
  }
  
  if (!contentElement) {
    contentElement = document.body;
  }
  
  // 获取所有段落文本
  const paragraphs = contentElement.querySelectorAll('p');
  let content = '';
  
  paragraphs.forEach(p => {
    const text = p.textContent.trim();
    if (text.length > 30) {
      content += text + '\n\n';
    }
  });
  
  // 如果没有段落，获取所有文本
  if (!content) {
    content = contentElement.innerText;
  }
  
  return {
    title: document.title,
    url: window.location.href,
    content: content.trim(),
    wordCount: content.trim().split(/\s+/).length
  };
}