/**
 * Claude AI 相关 IPC handlers
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { formatTimestamp } = require('./utils');

module.exports = function registerClaudeHandlers(ipcMain, { getClaudeConfig }) {
  // 调用 Claude 智能解决冲突（流式，思考/文本增量通过 IPC 实时推送给渲染进程）
  ipcMain.handle('claude-resolve-conflicts', async (ipcEvent, params) => {
    const timestamp = formatTimestamp();
    const { files, projectName, projectPath, operation } = params;
    console.log(`[${timestamp}] [claude-resolve-conflicts] 开始智能冲突处理: ${files.length} 个文件, 项目: ${projectName}`);

    try {
      const config = getClaudeConfig();
      if (!config.apiUrl || !config.apiKey) {
        return { success: false, error: '未配置 Claude API，请先在设置中配置' };
      }

      const client = new Anthropic({
        baseURL: config.apiUrl.replace(/\/$/, ''),
        apiKey: config.apiKey,
        // 流式请求：首字节超时给足（thinking 模型首 token 可能较慢），一旦开始流式即不会触发
        timeout: 180000,
        // 声明 1M 上下文（参考 cc-switch：剥离本地 [1m] 后缀，改用 beta 头启用）
        defaultHeaders: config.supports1M ? { 'anthropic-beta': 'context-1m-2025-08-07' } : undefined
      });

      // 构建文件内容块
      let filesBlock = '';
      for (const { path: filePath, content } of files) {
        filesBlock += `\n<FILE path="${filePath}">\n${content}\n</FILE>\n`;
      }

      const systemPrompt = `你是一个 Git 合并冲突解决助手。你会收到带有 Git 冲突标记(<<<<<<<, =======, >>>>>>>)的文件。
请解决所有冲突，并将每个解决后的文件用 <FILE path="...">...</FILE> 标签包裹返回。

规则：
1. 保留所有非冲突代码不变
2. 对每个冲突块，智能合并双方内容——不要简单地选择其中一方
3. 当双方都添加了新功能时，将它们合并
4. 当双方修改了同一行且逻辑不同时，选择更完整/正确的版本
5. 移除所有冲突标记(<<<<<<<, =======, >>>>>>>)
6. 返回完整的文件内容，不仅仅是解决的部分`;

      const userPrompt = `项目名称: ${projectName}
项目路径: ${projectPath}
操作: ${operation} 时发生冲突，请解决以下文件的冲突：
${filesBlock}`;

      console.log(`[${timestamp}] [claude-resolve-conflicts] 发送流式请求到 Claude, model: ${config.model}`);
      const stream = await client.messages.stream({
        model: config.model || 'claude-sonnet-4-6',
        max_tokens: 8192,
        messages: [
          { role: 'user', content: `${systemPrompt}\n\n${userPrompt}` }
        ]
      });

      // 实时推送思考与文本增量，累积文本用于最终解析
      let responseText = '';
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta) {
          if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            ipcEvent.sender.send('claude-resolve-stream', { type: 'thinking', data: ev.delta.thinking });
          } else if (ev.delta.type === 'text_delta' && ev.delta.text) {
            responseText += ev.delta.text;
            ipcEvent.sender.send('claude-resolve-stream', { type: 'text', data: ev.delta.text });
          }
        }
      }

      // 解析返回内容，提取 <FILE path="...">...</FILE> 块
      const resolvedFiles = [];
      const fileRegex = /<FILE\s+path="([^"]+)">\s*([\s\S]*?)\s*<\/FILE>/g;
      let match;
      while ((match = fileRegex.exec(responseText)) !== null) {
        resolvedFiles.push({ path: match[1], content: match[2] });
      }

      if (resolvedFiles.length === 0) {
        console.error(`[${timestamp}] [claude-resolve-conflicts] 无法解析 Claude 返回格式`);
        return { success: false, error: '无法解析 Claude 返回的文件内容，请重试' };
      }

      console.log(`[${timestamp}] [claude-resolve-conflicts] 成功解析 ${resolvedFiles.length} 个已解决文件`);
      return { success: true, files: resolvedFiles };
    } catch (error) {
      console.error(`[${timestamp}] [claude-resolve-conflicts] 失败: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // 读取本地 Claude 配置文件
  ipcMain.handle('claude-read-local-config', async () => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [claude-read-local-config] 读取本地 Claude 配置`);
    const os = require('os');

    // 辅助：剥离 [1m]/[1M] 标记，返回 { cleanName, supports1M }
    const parseModelName = (raw) => {
      const supports1M = raw.endsWith('[1m]') || raw.endsWith('[1M]');
      return {
        cleanName: supports1M ? raw.slice(0, -4) : raw,
        supports1M
      };
    };

    const homeDir = os.homedir();
    const config = {
      exists: false,
      apiUrl: '',
      apiKey: '',
      model: '',            // 剥离 [1m] 后的默认模型名
      modelSupports1M: false,
      models: [],           // 剥离 [1m] 后的模型名列表
      modelsMeta: {}        // { modelName: true } 表示该模型在配置中带有 [1m]
    };

    // 1. 环境变量
    if (process.env.ANTHROPIC_AUTH_TOKEN) {
      config.apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
    }
    if (process.env.ANTHROPIC_BASE_URL) {
      config.apiUrl = process.env.ANTHROPIC_BASE_URL;
    }
    if (process.env.ANTHROPIC_MODEL) {
      const parsed = parseModelName(process.env.ANTHROPIC_MODEL);
      config.model = parsed.cleanName;
      config.modelSupports1M = parsed.supports1M;
    }

    // 2. ~/.claude/settings.json
    const settingsPath = path.join(homeDir, '.claude', 'settings.json');
    try {
      if (fs.existsSync(settingsPath)) {
        const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const env = content.env || {};

        if (!config.apiKey && env.ANTHROPIC_AUTH_TOKEN) {
          config.apiKey = env.ANTHROPIC_AUTH_TOKEN;
        }
        if (!config.apiUrl && env.ANTHROPIC_BASE_URL) {
          config.apiUrl = env.ANTHROPIC_BASE_URL;
        }
        if (!config.model && env.ANTHROPIC_MODEL) {
          const parsed = parseModelName(env.ANTHROPIC_MODEL);
          config.model = parsed.cleanName;
          config.modelSupports1M = parsed.supports1M;
        }

        // 提取所有 *_MODEL 字段的模型名，剥离 [1m] 并记录标记
        const modelSet = new Set();
        const meta = {};
        Object.keys(env).forEach(key => {
          if (key.endsWith('_MODEL') || key === 'ANTHROPIC_MODEL') {
            const val = env[key];
            if (val && typeof val === 'string') {
              const parsed = parseModelName(val);
              modelSet.add(parsed.cleanName);
              if (parsed.supports1M) {
                meta[parsed.cleanName] = true;
              }
            }
          }
        });
        config.models = Array.from(modelSet);
        config.modelsMeta = meta;

        if (config.apiKey && config.apiUrl) {
          config.exists = true;
        }
      }
    } catch (e) {
      console.log(`[${timestamp}] [claude-read-local-config] 读取失败:`, e.message);
    }

    console.log(`[${timestamp}] [claude-read-local-config] 结果: exists=${config.exists}, models=${config.models.length}个, supports1M=${config.modelSupports1M}`);
    return { success: true, config };
  });

  // Claude API 模型列表获取（内部实现，供测试连接与获取模型列表共用）
  // 参考 cc-switch：通过 OpenAI 兼容的 GET /v1/models 端点验证连接/获取模型，
  // 不发送真实推理请求，避免上游账号池耗尽（503 No available accounts）等
  // 与连接本身无关的错误导致连接测试误判。
  const fetchClaudeModelsInternal = async (apiUrl, apiKey, logTag, asConnectionTest = false) => {
    const timestamp = formatTimestamp();

    // Anthropic 兼容 API 可能位于子路径下，需要剥离后缀尝试根路径
    const COMPAT_SUFFIXES = [
      '/api/claudecode', '/api/anthropic', '/apps/anthropic', '/api/coding',
      '/claudecode', '/anthropic', '/step_plan', '/coding', '/claude'
    ];

    // 辅助函数：判断 HTTP 错误是否为"端点不存在"
    const isNotFound = (err) => {
      const status = err?.status || err?.response?.status;
      return status === 404 || status === 405 || status === 501;
    };

    // 构建候选 URL 列表
    const buildUrlCandidates = (baseUrl) => {
      const urls = [];
      let url = baseUrl.replace(/\/+$/, ''); // 去尾部斜杠

      // 候选 1：直接拼接 /v1/models（针对 Anthropic SDK 路径）
      urls.push(`${url}/v1/models`);

      // 候选 2：如果已经是 /v{N} 结尾，直接拼 /models
      if (/\/v\d+$/.test(url)) {
        urls.push(`${url}/models`);
      }

      // 候选 3：剥离兼容后缀后，尝试根路径
      let strippedUrl = null;
      for (const suffix of COMPAT_SUFFIXES) {
        if (url.endsWith(suffix)) {
          strippedUrl = url.slice(0, -suffix.length);
          break;
        }
      }
      if (strippedUrl) {
        urls.push(`${strippedUrl}/v1/models`);
        urls.push(`${strippedUrl}/models`);
      }

      // 去重
      return [...new Set(urls)];
    };

    // 尝试解析响应（支持多种格式），并剥离 [1m]/[1M] 后缀
    // 部分代理的 /v1/models 会把"支持 1M 上下文"标记拼进模型 id（如 glm5.2[1M]），
    // 这里统一剥成 cleanName，并记录到 meta，避免下拉框中出现带后缀的独立条目。
    const parseModelsResponse = (data) => {
      let rawModels;
      if (Array.isArray(data)) rawModels = data.map(m => m.id || m).filter(Boolean);
      else if (data.data && Array.isArray(data.data)) rawModels = data.data.map(m => m.id).filter(Boolean);
      else if (data.models && Array.isArray(data.models)) rawModels = data.models.map(m => m.id || m).filter(Boolean);
      else return { models: [], meta: {} };

      const models = [];
      const meta = {};
      for (const raw of rawModels) {
        const supports1M = raw.endsWith('[1m]') || raw.endsWith('[1M]');
        const cleanName = supports1M ? raw.slice(0, -4) : raw;
        models.push(cleanName);
        if (supports1M) meta[cleanName] = true;
      }
      return { models: [...new Set(models)], meta };
    };

    const candidates = buildUrlCandidates(apiUrl);
    console.log(`[${timestamp}] [${logTag}] 候选 URL (${candidates.length}个):`, candidates);

    // 依次尝试每个候选 URL
    const errors = [];
    for (const candidateUrl of candidates) {
      console.log(`[${timestamp}] [${logTag}] 尝试: ${candidateUrl}`);
      try {
        const response = await axios.get(candidateUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          timeout: 15000
        });

        const { models, meta } = parseModelsResponse(response.data);
        if (models.length > 0) {
          console.log(`[${timestamp}] [${logTag}] ${asConnectionTest ? `验证成功, 端点 ${candidateUrl} 返回 ${models.length} 个模型` : `成功! 从 ${candidateUrl} 获取到 ${models.length} 个模型`}`);
          return { success: true, models, modelsMeta: meta, endpoint: candidateUrl };
        }
        // 响应 200 但无模型数据，记录并继续尝试
        console.log(`[${timestamp}] [${logTag}] 响应成功但无模型数据，继续尝试下一个`);
        errors.push(`${candidateUrl}: 返回空模型列表`);
      } catch (err) {
        const status = err?.response?.status || err?.status || 'network';
        console.log(`[${timestamp}] [${logTag}] ${candidateUrl} 失败: ${status}`);
        if (isNotFound(err)) {
          // 404/405 → 端点不存在，继续尝试下一个
          errors.push(`${candidateUrl}: HTTP ${status}`);
          continue;
        }
        // 其他错误（401/403/超时等）→ 立即返回
        const msg = err?.response?.data?.error?.message || err.message;
        return { success: false, error: `获取模型列表失败: ${msg}` };
      }
    }

    // 所有候选 URL 都返回 404/405 → 不支持
    console.log(`[${timestamp}] [${logTag}] ${asConnectionTest ? '所有候选 URL 均无法验证连接' : '所有候选 URL 均失败'}`);
    return {
      success: false,
      notSupported: true,
      error: asConnectionTest
        ? '无法连接到 API 服务，请检查地址与密钥'
        : '当前 API 服务不支持获取模型列表，请手动输入模型名称'
    };
  };

  // 测试 Claude API 连接（参考 cc-switch：用 GET /v1/models 验证，不发推理请求）
  ipcMain.handle('claude-test-connection', async (event, apiUrl, apiKey, model) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [claude-test-connection] 测试连接: ${apiUrl} (通过 GET /v1/models 验证)`);

    const result = await fetchClaudeModelsInternal(apiUrl, apiKey, 'claude-test-connection', true);
    if (result.success) {
      console.log(`[${timestamp}] [claude-test-connection] 连接正常, 可用模型 ${result.models.length} 个`);
      return { success: true, model: model || result.models[0], models: result.models };
    }
    console.error(`[${timestamp}] [claude-test-connection] 连接失败:`, result.error);
    return { success: false, error: result.error };
  });

  // 获取可用模型列表（参考 cc-switch 的多候选 URL 策略）
  ipcMain.handle('claude-fetch-models', async (event, apiUrl, apiKey) => {
    const timestamp = formatTimestamp();
    console.log(`[${timestamp}] [claude-fetch-models] 获取模型列表: ${apiUrl}`);
    return await fetchClaudeModelsInternal(apiUrl, apiKey, 'claude-fetch-models');
  });
};
