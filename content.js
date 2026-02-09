// content.js - 在网页上下文中运行

function extractContent() {
  // 策略 1：优先提取 article 标签
  const article = document.querySelector('article');
  if (article) return article.innerText;
  
  // 策略 2：提取 main 标签
  const main = document.querySelector('main');
  if (main) return main.innerText;
  
  // 策略 3：智能提取最大文本块（基于 Readability 算法简化版）
  const candidates = document.querySelectorAll('p, div, section');
  let bestElement = null;
  let maxTextLength = 0;
  
  candidates.forEach(el => {
    const text = el.innerText.trim();
    // 过滤导航、广告等
    if (text.length > maxTextLength && 
        text.length > 200 && 
        !el.closest('nav, header, footer, aside, .sidebar, .advertisement')) {
      maxTextLength = text.length;
      bestElement = el;
    }
  });
  
  if (bestElement) return bestElement.innerText;
  
  // 策略 4：兜底，提取所有段落
  const paragraphs = document.querySelectorAll('p');
  return Array.from(paragraphs).map(p => p.innerText).join('\n');
}

// 清理文本
function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')           // 合并多余空白
    .replace(/\n{3,}/g, '\n\n')     // 合并多余换行
    .trim()
    .slice(0, 15000);               // 限制长度，避免超出 Token 限制
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    const rawContent = extractContent();
    const cleanContent = cleanText(rawContent);
    
    sendResponse({
      success: true,
      content: cleanContent,
      url: window.location.href,
      title: document.title,
      length: cleanContent.length
    });
  }
  return true; // 保持消息通道开放
});