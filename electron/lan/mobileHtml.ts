/**
 * 生成提供给移动端浏览器访问的单页 H5。
 * 无需外网连接，全部样式与脚本内联，支持离线局域网快速加载。
 */
export function getMobileHtml(serverName = '归一 Unyra'): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>${serverName} · 局域网互联传输</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: rgba(30, 41, 59, 0.75);
      --card-border: rgba(255, 255, 255, 0.1);
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --primary-glow: rgba(56, 189, 248, 0.25);
      --success: #34d399;
      --danger: #f87171;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --radius: 20px;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    }
    body {
      background: var(--bg);
      background-image: radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.14) 0px, transparent 50%),
                        radial-gradient(at 100% 100%, rgba(99, 102, 241, 0.12) 0px, transparent 50%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      padding: 16px;
      padding-top: calc(16px + env(safe-area-inset-top));
      padding-bottom: calc(16px + env(safe-area-inset-bottom));
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      color: #0f172a;
    }
    .brand-title {
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .status-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 500;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid var(--card-border);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #94a3b8;
    }
    .status-dot.online {
      background: var(--success);
      box-shadow: 0 0 10px var(--success);
    }
    .status-dot.offline {
      background: var(--danger);
    }

    .main-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(16px);
      border-radius: var(--radius);
      padding: 32px 20px;
      margin-bottom: 20px;
      text-align: center;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.3);
      transition: all 0.3s ease;
    }

    /* 默认等待状态：暂未收到服务端资源请求 */
    .idle-view {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 8px;
    }
    .radar-wrapper {
      position: relative;
      width: 100px;
      height: 100px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 24px;
    }
    .radar-ripple {
      position: absolute;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 1.5px solid rgba(56, 189, 248, 0.4);
      animation: radarPing 2.5s cubic-bezier(0, 0.2, 0.8, 1) infinite;
    }
    .radar-ripple:nth-child(2) {
      animation-delay: 1.25s;
    }
    @keyframes radarPing {
      0% {
        transform: scale(0.6);
        opacity: 0.8;
      }
      100% {
        transform: scale(1.4);
        opacity: 0;
      }
    }
    .idle-center-icon {
      position: relative;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--primary);
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.2);
    }
    .idle-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 10px;
      color: var(--text);
    }
    .idle-desc {
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-muted);
      max-width: 290px;
    }

    /* 服务端发来意图请求时的上传卡片 */
    .request-view {
      display: none;
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .req-header-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      background: rgba(56, 189, 248, 0.15);
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: var(--primary);
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 14px;
    }
    .req-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .prompt-box {
      font-size: 14px;
      color: #f1f5f9;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 20px;
      line-height: 1.55;
      text-align: left;
    }
    .action-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 18px;
      border-radius: 12px;
      border: 1px solid var(--card-border);
      background: rgba(255, 255, 255, 0.07);
      color: var(--text);
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn:active {
      transform: scale(0.98);
      background: rgba(255, 255, 255, 0.14);
    }
    .btn-primary {
      background: var(--primary);
      color: #0f172a;
      font-weight: 600;
      border: none;
      box-shadow: 0 4px 16px var(--primary-glow);
    }
    .btn-primary:active {
      background: var(--primary-hover);
    }
    .btn-danger {
      background: transparent;
      color: var(--text-muted);
      border: none;
      padding: 10px;
      font-size: 13px;
    }
    .btn-danger:active {
      color: var(--danger);
      background: rgba(248, 113, 113, 0.1);
    }

    /* 上传进度 */
    .progress-box {
      margin-top: 16px;
      padding: 14px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.3);
      display: none;
      text-align: left;
    }
    .progress-box.show {
      display: block;
    }
    .progress-info {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      margin-bottom: 8px;
      color: var(--text-muted);
    }
    .progress-bar-bg {
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 9999px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #38bdf8, #818cf8);
      width: 0%;
      transition: width 0.15s ease;
    }

    /* 历史记录卡片（有记录时才展示，无记录时默认隐藏以消除视觉噪声） */
    .history-card {
      display: none;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      backdrop-filter: blur(16px);
      border-radius: var(--radius);
      padding: 16px;
      flex-direction: column;
      overflow: hidden;
      margin-top: 16px;
    }
    .history-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .history-list {
      list-style: none;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .history-item {
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
    }
    .history-item-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 65%;
      font-weight: 500;
    }
    .history-item-meta {
      font-size: 11px;
      color: var(--text-muted);
    }

    input[type="file"] {
      display: none;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo-icon">U</div>
      <div class="brand-title">${serverName} 传输</div>
    </div>
    <div class="status-badge">
      <div id="statusDot" class="status-dot"></div>
      <span id="statusText">连接中...</span>
    </div>
  </header>

  <div class="main-card">
    <!-- 默认视图：暂未收到服务端资源请求 -->
    <div class="idle-view" id="idleView">
      <div class="radar-wrapper">
        <div class="radar-ripple"></div>
        <div class="radar-ripple"></div>
        <div class="idle-center-icon">
          <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v7.5a3 3 0 0 1-3 3Z" />
          </svg>
        </div>
      </div>
      <h3 class="idle-title">暂未收到服务端资源请求</h3>
      <p class="idle-desc">设备已与电脑成功连接。<br>需要等服务端发送资源请求才能上传文件。</p>
    </div>

    <!-- 收到请求时的上传操作视图 -->
    <div class="request-view" id="requestView">
      <div class="req-header-badge">
        <span>⚡ 资源请求</span>
      </div>
      <h3 class="req-title">电脑端请求上传文件</h3>
      <div class="prompt-box" id="intentPrompt">请拍摄或选取文件</div>

      <div class="action-group" id="actionGroup">
        <button class="btn btn-primary" id="btnIntentCamera">📷 拍照 / 相册</button>
        <button class="btn" id="btnIntentFile">📁 选择文件</button>
        <button class="btn btn-danger" id="btnIntentReject">暂不上传</button>
      </div>

      <div class="progress-box" id="progressBox">
        <div class="progress-info">
          <span id="progressName">准备上传...</span>
          <span id="progressPercent">0%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" id="progressBar"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="history-card" id="historyCard">
    <div class="history-title">
      <span>传输记录</span>
      <span id="historyCount">0 项</span>
    </div>
    <ul class="history-list" id="historyList">
    </ul>
  </div>

  <!-- 隐藏的文件选择器 -->
  <input type="file" id="cameraFileInput" accept="image/*" capture="environment">
  <input type="file" id="intentFileInput">

  <script>
    (function() {
      let deviceId = localStorage.getItem('unyra_device_id');
      if (!deviceId) {
        deviceId = 'dev_' + Math.random().toString(36).slice(2, 9);
        localStorage.setItem('unyra_device_id', deviceId);
      }

      function getDeviceName() {
        const ua = navigator.userAgent;
        if (/iPhone/i.test(ua)) return 'iPhone 手机';
        if (/iPad/i.test(ua)) return 'iPad 平板';
        if (/Android/i.test(ua)) return 'Android 移动设备';
        if (/Mac/i.test(ua)) return 'Mac 电脑';
        if (/Windows/i.test(ua)) return 'Windows 电脑';
        return '移动设备';
      }

      const statusDot = document.getElementById('statusDot');
      const statusText = document.getElementById('statusText');
      const idleView = document.getElementById('idleView');
      const requestView = document.getElementById('requestView');
      const intentPrompt = document.getElementById('intentPrompt');
      const btnIntentCamera = document.getElementById('btnIntentCamera');
      const btnIntentFile = document.getElementById('btnIntentFile');
      const btnIntentReject = document.getElementById('btnIntentReject');
      const cameraFileInput = document.getElementById('cameraFileInput');
      const intentFileInput = document.getElementById('intentFileInput');
      const progressBox = document.getElementById('progressBox');
      const progressName = document.getElementById('progressName');
      const progressPercent = document.getElementById('progressPercent');
      const progressBar = document.getElementById('progressBar');
      const historyCard = document.getElementById('historyCard');
      const historyList = document.getElementById('historyList');
      const historyCount = document.getElementById('historyCount');

      let currentIntent = null;
      let historyItems = [];
      let ws = null;
      let reconnectTimer = null;

      function updateStatus(online) {
        if (online) {
          statusDot.className = 'status-dot online';
          statusText.textContent = '已连接电脑';
        } else {
          statusDot.className = 'status-dot offline';
          statusText.textContent = '连接中断，重连中...';
        }
      }

      function showIdle() {
        requestView.style.display = 'none';
        idleView.style.display = 'flex';
        currentIntent = null;
      }

      function showRequest(req) {
        currentIntent = req;
        intentPrompt.textContent = req.prompt || '电脑端请求您上传一份文件';

        if (req.accept) {
          intentFileInput.accept = req.accept;
          cameraFileInput.accept = req.accept;
          if (req.accept.includes('image')) {
            btnIntentCamera.style.display = 'flex';
          }
        } else {
          intentFileInput.removeAttribute('accept');
          cameraFileInput.accept = 'image/*';
          btnIntentCamera.style.display = 'flex';
        }

        idleView.style.display = 'none';
        requestView.style.display = 'block';

        if (navigator.vibrate) {
          try { navigator.vibrate([100, 60, 100]); } catch (e) {}
        }
      }

      function connectWs() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = proto + '//' + location.host + '/ws';
        try {
          ws = new WebSocket(wsUrl);
          ws.onopen = function() {
            updateStatus(true);
            ws.send(JSON.stringify({
              type: 'device_join',
              deviceId: deviceId,
              deviceName: getDeviceName(),
              userAgent: navigator.userAgent
            }));
          };
          ws.onmessage = function(e) {
            try {
              const msg = JSON.parse(e.data);
              if (msg.type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong' }));
              } else if (msg.type === 'request_file') {
                showRequest(msg);
              }
            } catch (err) {
              console.error('WS parse error', err);
            }
          };
          ws.onclose = function() {
            updateStatus(false);
            scheduleReconnect();
          };
          ws.onerror = function() {
            updateStatus(false);
            ws.close();
          };
        } catch (e) {
          updateStatus(false);
          scheduleReconnect();
        }
      }

      function scheduleReconnect() {
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(function() {
          reconnectTimer = null;
          connectWs();
        }, 2000);
      }

      btnIntentReject.addEventListener('click', function() {
        if (currentIntent && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'intent_rejected',
            requestId: currentIntent.requestId,
            reason: '用户在移动端取消了上传'
          }));
        }
        showIdle();
      });

      btnIntentCamera.addEventListener('click', function() {
        cameraFileInput.click();
      });

      btnIntentFile.addEventListener('click', function() {
        intentFileInput.click();
      });

      cameraFileInput.addEventListener('change', function() {
        if (this.files && this.files.length) {
          const reqId = currentIntent ? currentIntent.requestId : undefined;
          uploadFiles(Array.from(this.files), reqId);
          this.value = '';
        }
      });

      intentFileInput.addEventListener('change', function() {
        if (this.files && this.files.length) {
          const reqId = currentIntent ? currentIntent.requestId : undefined;
          uploadFiles(Array.from(this.files), reqId);
          this.value = '';
        }
      });

      function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      }

      function addHistory(file) {
        historyItems.unshift(file);
        renderHistory();
      }

      function renderHistory() {
        if (!historyCard) return;
        historyCount.textContent = historyItems.length + ' 项';
        if (historyItems.length === 0) {
          historyCard.style.display = 'none';
          historyList.innerHTML = '';
          return;
        }
        historyCard.style.display = 'flex';
        historyList.innerHTML = historyItems.map(function(item) {
          const time = new Date(item.uploadTime || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return '<li class="history-item">' +
            '<div class="history-item-name">' + (item.name || '未命名') + '</div>' +
            '<div class="history-item-meta">' + formatSize(item.size || 0) + ' · ' + time + '</div>' +
          '</li>';
        }).join('');
      }

      function uploadFiles(files, requestId) {
        if (!files || files.length === 0) return;
        let index = 0;

        function next() {
          if (index >= files.length) {
            setTimeout(function() {
              progressBox.classList.remove('show');
              // 上传完毕后切回默认等待状态
              showIdle();
            }, 1200);
            return;
          }
          const file = files[index];
          index++;

          progressBox.classList.add('show');
          progressName.textContent = '正在上传：' + file.name;
          progressPercent.textContent = '0%';
          progressBar.style.width = '0%';

          const xhr = new XMLHttpRequest();
          const query = [
            'filename=' + encodeURIComponent(file.name),
            'deviceId=' + encodeURIComponent(deviceId),
            'deviceName=' + encodeURIComponent(getDeviceName())
          ];
          if (requestId) query.push('requestId=' + encodeURIComponent(requestId));

          xhr.open('POST', '/api/upload?' + query.join('&'), true);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

          xhr.upload.onprogress = function(e) {
            if (e.lengthComputable) {
              const p = Math.round((e.loaded / e.total) * 100);
              progressPercent.textContent = p + '%';
              progressBar.style.width = p + '%';
            }
          };

          xhr.onload = function() {
            if (xhr.status === 200) {
              try {
                const res = JSON.parse(xhr.responseText);
                if (res.ok && res.file) {
                  addHistory(res.file);
                }
              } catch (e) {}
              progressPercent.textContent = '100% 完成';
              progressBar.style.width = '100%';
              next();
            } else {
              alert('上传失败，状态码：' + xhr.status);
              progressBox.classList.remove('show');
              showIdle();
            }
          };

          xhr.onerror = function() {
            alert('上传遇到网络错误');
            progressBox.classList.remove('show');
            showIdle();
          };

          xhr.send(file);
        }

        next();
      }

      connectWs();
    })();
  </script>
</body>
</html>`;
}
