document.addEventListener('DOMContentLoaded', function() {
  const summarizeBtn = document.getElementById('summarizeBtn');
  const copyBtn = document.getElementById('copyBtn');
  const status = document.getElementById('status');
  const result = document.getElementById('result');
  const summaryText = document.getElementById('summaryText');

  summarizeBtn.addEventListener('click', async () => {
    status.textContent = '正在提取内容...';
    status.className = 'status loading';
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: extractContent
      });
      
      const content = results[0].result;
      
      // 简单的摘要逻辑（实际使用中可以调用API）
      const summary = generateSummary(content);
      
      summaryText.textContent = summary;
      result.classList.remove('hidden');
      status.textContent = '提取完成';
      status.className = 'status success';
    } catch (error) {
      status.textContent = '提取失败: ' + error.message;
      status.className = 'status error';
    }
  });

  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(summaryText.textContent).then(() => {
      copyBtn.textContent = '已复制';
      setTimeout(() => {
        copyBtn.textContent = '复制';
      }, 2000);
    });
  });

  function extractContent() {
    // 提取页面主要文本内容
    const article = document.querySelector('article') || document.body;
    const paragraphs = article.querySelectorAll('p');
    let text = '';
    paragraphs.forEach(p => {
      if (p.textContent.trim().length > 50) {
        text += p.textContent.trim() + '\n\n';
      }
    });
    return text || document.body.innerText;
  }

  function generateSummary(text) {
    // 简单的摘要生成（取前500字符）
    if (text.length <= 500) return text;
    return text.substring(0, 500) + '...';
  }
});