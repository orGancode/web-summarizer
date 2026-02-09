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
  });
  
  // 提供商切换时更新帮助文本和 API Key
  document.getElementById('provider').addEventListener('change', (e) => {
    console.log('Provider change event triggered');
    const provider = e.target.value;
    console.log('Selected provider:', provider);
    const helps = {
      zhipu: '获取地址：https://open.bigmodel.cn/',
      openai: '获取地址：https://platform.openai.com/api-keys',
      deepseek: '获取地址：https://platform.deepseek.com/'
    };
    const keyHelpElement = document.getElementById('keyHelp');
    console.log('keyHelp element:', keyHelpElement);
    console.log('Setting text to:', helps[provider]);
    keyHelpElement.textContent = helps[provider];
    // 显示当前 provider 对应的 API Key
    document.getElementById('apiKey').value = allApiKeys[provider] || '';
  });
  
  // 保存配置
  document.getElementById('saveBtn').addEventListener('click', async () => {
    console.log('Save button clicked');
    const provider = document.getElementById('provider').value;
    const apiKey = document.getElementById('apiKey').value.trim();
    console.log('Provider:', provider, 'API Key:', apiKey);
    
    // 合并 API Keys，保留其他 provider 的设置
    allApiKeys[provider] = apiKey;
    
    const config = {
      provider,
      apiKeys: allApiKeys
    };
    
    try {
      // 检查存储空间
      const bytesInUse = await chrome.storage.sync.getBytesInUse(['aiConfig']);
      const bytesToAdd = JSON.stringify(config).length;
      if (bytesInUse + bytesToAdd > 8000) {
        throw new Error('存储空间不足，请删除一些旧配置');
      }

      await chrome.storage.sync.set({ aiConfig: config });
      // 验证保存成功
      const verify = await chrome.storage.sync.get(['aiConfig']);
      if (!verify.aiConfig || verify.aiConfig.apiKeys[provider] !== apiKey) {
        throw new Error('保存验证失败，请重试');
      }
      
      const savedMsg = document.getElementById('savedMsg');
      savedMsg.classList.remove('hidden');
      setTimeout(() => savedMsg.classList.add('hidden'), 3000);
    } catch (error) {
      console.error('保存失败:', error);
      alert('保存失败: ' + error.message);
    }
  });
});
