// content.js - 在网页上下文中运行

// 图片提取器
function extractImages() {
  const images = [];
  const seenUrls = new Set();

  // 获取所有图片
  const imgElements = document.querySelectorAll('img');

  imgElements.forEach(img => {
    const src = img.src || img.dataset.src || img.dataset.lazySrc;
    if (!src || seenUrls.has(src)) return;

    const rect = img.getBoundingClientRect();
    // 只提取可见且尺寸足够的图片
    if (rect.width < 100 || rect.height < 100) return;

    const alt = img.alt || '';
    const context = getImageContext(img);

    images.push({
      src: src,
      alt: alt,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      context: context,
      inContent: isInMainContent(img)
    });

    seenUrls.add(src);
  });

  // 按相关性排序（优先内容区图片）
  return images.sort((a, b) => {
    if (a.inContent && !b.inContent) return -1;
    if (!a.inContent && b.inContent) return 1;
    // 尺寸大的优先
    return (b.width * b.height) - (a.width * a.height);
  }).slice(0, 10); // 最多10张图
}

// 获取图片上下文描述
function getImageContext(img) {
  const parent = img.parentElement;
  const prevSibling = img.previousElementSibling;
  const nextSibling = img.nextElementSibling;

  let context = '';

  // 标题
  if (prevSibling) {
    const heading = prevSibling.querySelector('h1, h2, h3, h4');
    if (heading) context = heading.innerText.slice(0, 50);
  }

  // 描述
  if (!context && nextSibling) {
    const desc = nextSibling.querySelector('p, .caption');
    if (desc) context = desc.innerText.slice(0, 100);
  }

  // figure/figcaption
  const figure = img.closest('figure');
  if (figure) {
    const caption = figure.querySelector('figcaption');
    if (caption) context = caption.innerText.slice(0, 100);
  }

  return context;
}

// 判断是否在主要内容区域
function isInMainContent(el) {
  const article = el.closest('article, main, [role="main"], .post-content, .article-content');
  return !!article;
}

// SVG/图表提取
function extractCharts() {
  const charts = [];

  // 提取svg图表
  document.querySelectorAll('svg').forEach(svg => {
    const rect = svg.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) return;

    const title = svg.querySelector('title')?.textContent ||
                  svg.closest('figure')?.querySelector('figcaption')?.textContent ||
                  '';

    charts.push({
      type: 'svg',
      content: svg.outerHTML,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      description: title
    });
  });

  // 提取canvas图表
  document.querySelectorAll('canvas').forEach(canvas => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 100) return;

    charts.push({
      type: 'canvas',
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      dataUrl: canvas.toDataURL()
    });
  });

  // 提取图表容器（可能需要截图）
  document.querySelectorAll('.chart, .graph, .diagram, [data-chart]').forEach(el => {
    const rect = el.getBoundingClientRect();
    charts.push({
      type: 'container',
      className: el.className,
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    });
  });

  return charts.slice(0, 5);
}

// 提取表格数据
function extractTables() {
  const tables = [];

  document.querySelectorAll('table').forEach(table => {
    if (table.rows.length < 2) return;

    const caption = table.querySelector('caption')?.textContent ||
                    table.closest('figure')?.querySelector('figcaption')?.textContent || '';

    const headers = [];
    table.querySelectorAll('th').forEach(th => {
      headers.push(th.innerText.slice(0, 30));
    });

    tables.push({
      caption: caption.slice(0, 100),
      headers: headers.slice(0, 10),
      rows: Math.min(table.rows.length, 20) // 最多20行
    });
  });

  return tables;
}

// 提取内容（原有功能增强）
function extractContent() {
  // 策略 1：优先提取 article 标签
  const article = document.querySelector('article');
  if (article) return {
    text: article.innerText,
    element: article
  };

  // 策略 2：提取 main 标签
  const main = document.querySelector('main');
  if (main) return {
    text: main.innerText,
    element: main
  };

  // 策略 3：智能提取最大文本块
  const candidates = document.querySelectorAll('p, div, section');
  let bestElement = null;
  let maxTextLength = 0;

  candidates.forEach(el => {
    const text = el.innerText.trim();
    if (text.length > maxTextLength &&
        text.length > 200 &&
        !el.closest('nav, header, footer, aside, .sidebar, .advertisement')) {
      maxTextLength = text.length;
      bestElement = el;
    }
  });

  if (bestElement) return {
    text: bestElement.innerText,
    element: bestElement
  };

  // 策略 4：兜底
  const paragraphs = document.querySelectorAll('p');
  return {
    text: Array.from(paragraphs).map(p => p.innerText).join('\n'),
    element: document.body
  };
}

// 清理文本
function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 15000);
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extract') {
    const content = extractContent();
    const cleanContent = cleanText(content.text);
    const images = extractImages();
    const charts = extractCharts();
    const tables = extractTables();

    sendResponse({
      success: true,
      content: cleanContent,
      url: window.location.href,
      title: document.title,
      length: cleanContent.length,
      images: images,
      charts: charts,
      tables: tables
    });
  }
  return true;
});
