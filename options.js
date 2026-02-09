document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM Content Loaded');
  let allApiKeys = {};
  
  // 加载保存的配置
  chrome.storage.sync.get(['aiConfig'], (result) => {
    if (result.aiConfig) {
      const config = result.aiConfig;
      document.getElementById('provider').value = config.provider || 'zhipu';
      allApiKeys = config.apiKeys || {};
      document.getElementById('apiKey').value = allApiKeys[config.provider || 'zhipu'] || '';
    }
    updateHelpText(document.getElementById('provider').value || 'zhipu');
  });

  function updateHelpText(provider) {
    const helps = {
      zhipu: '获取地址：<a href="https://open.bigmodel.cn/" target="_blank" class="help-link">https://open.bigmodel.cn/</a>',
      openai: '获取地址：<a href="https://platform.openai.com/api-keys" target="_blank" class="help-link">https://platform.openai.com/api-keys</a>',
      deepseek: '获取地址：<a href="https://platform.deepseek.com/" target="_blank" class="help-link">https://platform.deepseek.com/</a>'
    };
    document.getElementById('keyHelp').innerHTML = helps[provider] || helps.zhipu;
  }

  document.getElementById('provider').addEventListener('change', (e) => {
    const provider = e.target.value;
    document.getElementById('apiKey').value = allApiKeys[provider] || '';
    updateHelpText(provider);
  });

  document.getElementById('saveBtn').addEventListener('click', async () => {
    const provider = document.getElementById('provider').value;
    const apiKey = document.getElementById('apiKey').value.trim();

    allApiKeys[provider] = apiKey;

    const config = {
      provider,
      apiKeys: allApiKeys
    };

    try {
      await chrome.storage.sync.set({ aiConfig: config });

      const savedMsg = document.getElementById('savedMsg');
      savedMsg.classList.remove('hidden');
      setTimeout(() => savedMsg.classList.add('hidden'), 2000);
    } catch (error) {
      alert('保存失败: ' + error.message);
    }
  });
});
