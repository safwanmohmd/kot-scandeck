(function () {
  // ---------------------------------------------------------------------------
  // 0. Auto-Update Engine Config
  // ---------------------------------------------------------------------------
  const CURRENT_VERSION = "3.1";
  // Replace this URL with your raw GitHub or web server link pointing to version.json
  const VERSION_CHECK_URL = "https://raw.githubusercontent.com/safwanmohmd/kot-scandeck-version/refs/heads/main/version.json";

  async function checkForUpdates() {
    try {
      const response = await fetch(`${VERSION_CHECK_URL}?t=${Date.now()}`);
      if (!response.ok) return;

      const data = await response.json();
      if (data.latestVersion && data.latestVersion !== CURRENT_VERSION) {
        showUpdateBanner(data.latestVersion, data.downloadUrl);
      }
    } catch (e) {
      console.log("Version check skipped:", e);
    }
  }

  function showUpdateBanner(newVersion, downloadUrl) {
    const banner = shadowRoot.getElementById('update-banner');
    const textEl = shadowRoot.getElementById('update-banner-text');
    const btn = shadowRoot.getElementById('update-download-btn');

    if (banner && textEl && btn) {
      textEl.textContent = `🚀 Update Available (v${newVersion})!`;
      banner.style.display = 'flex';
      btn.onclick = () => {
        window.open(downloadUrl, '_blank');
      };
    }
  }

  // Saved Settings for RTO Alarm
  let enableRtoAlarm = localStorage.getItem('barcode_enable_rto_alarm') === 'true';

  // ---------------------------------------------------------------------------
  // 1. Custom Audio File Player & RTO Engine
  // ---------------------------------------------------------------------------
  function playRTOAlarmSound() {
    try {
      const soundUrl = chrome.runtime.getURL('alarm.mp3');
      const audio = new Audio(soundUrl);
      audio.volume = 1.0;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.warn("Audio playback blocked. Click anywhere on the page once to enable audio.", error);
        });
      }
    } catch (e) {
      console.error("Custom RTO Sound Alert failed:", e);
    }
  }

  let lastRtoState = "";

  function inspectPageForRTO() {
    if (!enableRtoAlarm) return;

    let currentRtoValue = "NO";
    const elements = Array.from(document.querySelectorAll('span, div, td, p'));

    const rtoLabelNode = elements.find(el => {
      const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
      return text === "IS RTO" || text === "IS RTO:";
    });

    if (rtoLabelNode) {
      const parentContainer = rtoLabelNode.closest('div');
      const containerText = parentContainer ? parentContainer.textContent.toUpperCase() : '';

      if (containerText.includes('YES') && !containerText.includes('IS RTO CV')) {
        currentRtoValue = "YES";
      }
    } else {
      const normalizedBodyText = (document.body.textContent || document.body.innerText || '')
        .replace(/\s+/g, ' ')
        .toUpperCase();

      if (normalizedBodyText.includes('IS RTO YES')) {
        currentRtoValue = "YES";
      }
    }

    if (currentRtoValue === "YES" && lastRtoState !== "YES") {
      playRTOAlarmSound();
    }

    lastRtoState = currentRtoValue;
  }

  const rtoObserver = new MutationObserver(() => {
    inspectPageForRTO();
  });

  rtoObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });

  // ---------------------------------------------------------------------------
  // 2. Extension Handshake Bridge
  // ---------------------------------------------------------------------------
  window.addEventListener('CHECK_BARCODE_EXTENSION', () => {
    window.dispatchEvent(new CustomEvent('BARCODE_EXTENSION_INSTALLED', {
      detail: { version: CURRENT_VERSION, installed: true }
    }));
  });

  window.addEventListener('LOAD_TRACKING_IDS_TO_EXTENSION', (event) => {
    if (event.detail && event.detail.trackingIds) {
      const barcodeInput = shadowRoot.getElementById('barcode-input');
      if (barcodeInput) {
        barcodeInput.value = event.detail.trackingIds;
        processAndFilterQueue();
        panel.classList.remove('panel-hidden');
        panelBody.classList.remove('minimized');
      }
    }
  });

  if (document.getElementById('barcode-injector-root')) return;

  // ---------------------------------------------------------------------------
  // 3. Constants & State Variables
  // ---------------------------------------------------------------------------
  const TRACKING_ID_EXTRACT_REGEX = /^[A-Z]{3,4}[A-Z0-9\-_]{5,15}$/i;

  let isRunning = false;
  let isPaused = false;
  let shouldStop = false;
  let trackingQueue = [];
  let currentIndex = 0;

  // Saved Settings
  let toggleHotkey = localStorage.getItem('barcode_toggle_hotkey') || 'Alt + S';
  let startHotkey = localStorage.getItem('barcode_start_hotkey') || 'Alt + X';
  let scanDelay = parseInt(localStorage.getItem('barcode_scan_delay') || '700', 10);
  let isolateTracking = localStorage.getItem('barcode_isolate_tracking') !== 'false';
  let enableExclusions = localStorage.getItem('barcode_enable_exclusions') !== 'false';
  let excludeWords = localStorage.getItem('barcode_exclude_words') || 'FORWARD, UNDELIVERED, FLIPKART, ESCALATION, VERIFICATION, SHIPMENTS, PACKAGING, MANDATORY';

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'TOGGLE_PANEL') {
        panel.classList.toggle('panel-hidden');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Shadow DOM Container Setup & CSS
  // ---------------------------------------------------------------------------
  const rootContainer = document.createElement('div');
  rootContainer.id = 'barcode-injector-root';
  document.body.appendChild(rootContainer);

  const shadowRoot = rootContainer.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    #panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 330px;
      min-width: 260px;
      max-width: 550px;
      min-height: 200px;
      background: #ffffff;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.15);
      z-index: 999999;
      overflow: auto;
      resize: both;
      display: flex;
      flex-direction: column;
    }
    #panel.panel-hidden { display: none !important; }
    .header {
      background: #1e293b;
      color: #ffffff;
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      user-select: none;
      flex-shrink: 0;
    }
    .header-title { font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px; }
    .header-btns { display: flex; gap: 6px; align-items: center; }
    .header-btns button {
      background: none; border: none; color: #94a3b8; font-size: 13px; cursor: pointer; padding: 0 2px;
    }
    .header-btns button:hover { color: #ffffff; }
    .body { padding: 10px; display: flex; flex-direction: column; gap: 8px; overflow-y: auto; flex-grow: 1; }
    .body.minimized { display: none; }
    
    .update-banner {
      background: #fef3c7;
      border: 1px solid #f59e0b;
      color: #92400e;
      padding: 6px 8px;
      border-radius: 6px;
      display: none;
      align-items: center;
      justify-content: space-between;
      font-size: 10px;
      font-weight: bold;
    }
    .btn-update-dl {
      background: #f59e0b;
      color: white;
      border: none;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 10px;
    }
    .btn-update-dl:hover { background: #d97706; }

    label { font-size: 10px; font-weight: 700; color: #475569; text-transform: uppercase; }
    textarea {
      width: 100%; height: 55px; padding: 6px; border: 1px solid #cbd5e1; border-radius: 6px;
      font-size: 11px; font-family: monospace; resize: vertical; outline: none;
    }

    .btn-group { display: flex; gap: 6px; }
    button.btn {
      flex: 1; padding: 6px; border: none; border-radius: 6px; font-weight: 600; font-size: 11px;
      cursor: pointer; transition: all 0.15s ease; display: flex; align-items: center; justify-content: center; gap: 4px;
    }
    .btn-primary { background: #2563eb; color: white; }
    .btn-warning { background: #f59e0b; color: white; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-reset { background: #dc2626; color: white; width: 100%; font-weight: 700; padding: 6px; }
    .btn-secondary { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }

    .progress-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px; }
    .progress-bar-bg { background: #e2e8f0; height: 5px; border-radius: 3px; overflow: hidden; margin-top: 4px; }
    .progress-bar-fill { background: #2563eb; height: 100%; width: 0%; transition: width 0.2s ease; }
    .status-text { font-size: 10px; color: #64748b; display: flex; justify-content: space-between; }

    .filter-section {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px;
      display: flex; flex-direction: column; gap: 5px;
    }
    .filter-checkbox-row { display: flex; align-items: center; justify-content: space-between; font-size: 10px; font-weight: 600; color: #334155; }
    
    .filter-checkbox-row input[type="checkbox"] {
      appearance: none;
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      border: 1.5px solid #cbd5e1;
      border-radius: 4px;
      background-color: #ffffff;
      cursor: pointer;
      display: grid;
      place-content: center;
      transition: all 0.15s ease-in-out;
    }

    .filter-checkbox-row input[type="checkbox"]:checked {
      background-color: #2563eb;
      border-color: #2563eb;
    }

    .filter-checkbox-row input[type="checkbox"]:checked::before {
      content: "";
      width: 3px;
      height: 6px;
      border: solid white;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
      margin-bottom: 1px;
    }
    
    .settings-grid {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px;
      display: flex; flex-direction: column; gap: 5px;
    }
    .setting-row { display: flex; justify-content: space-between; align-items: center; }
    .setting-input {
      background: #ffffff; border: 1px solid #cbd5e1; border-radius: 4px; padding: 2px 4px;
      font-size: 10px; font-weight: bold; color: #2563eb; width: 90px; text-align: center; cursor: pointer;
    }
  `;

  const panel = document.createElement('div');
  panel.id = 'panel';
  panel.className = 'panel-hidden';
  panel.innerHTML = `
    <div class="header" id="drag-handle">
      <span class="header-title">⚡ KOT-ScanDeck v${CURRENT_VERSION}</span>
      <div class="header-btns">
        <button id="minimize-btn" title="Minimize">—</button>
        <button id="close-btn" title="Close Panel">✕</button>
      </div>
    </div>
    <div class="body" id="panel-body">
      <!-- UPDATE BANNER -->
      <div id="update-banner" class="update-banner">
        <span id="update-banner-text">🚀 New Update Available!</span>
        <button id="update-download-btn" class="btn-update-dl">📥 Get Update</button>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
          <label>Raw Data Input</label>
          <button id="paste-btn" class="btn btn-secondary" style="padding:1px 5px; font-size:9px;">📋 Paste</button>
        </div>
        <textarea id="barcode-input" placeholder="Paste manifest / logs here..."></textarea>
      </div>

      <!-- FILTER CONTROLS & RTO SETTINGS -->
      <div class="filter-section">
        <div class="filter-checkbox-row">
          <span>🔊 Enable RTO Custom Alarm</span>
          <input type="checkbox" id="enable-rto-alarm-chk" ${enableRtoAlarm ? 'checked' : ''} />
        </div>

        <div class="setting-row">
          <label style="text-transform:none; font-size:10px;">Custom Sound Test:</label>
          <button id="test-sound-btn" class="btn btn-secondary" style="padding: 2px 6px; font-size:9px;" title="Test Audio">🔊 Test MP3</button>
        </div>

        <div class="filter-checkbox-row">
          <span>Isolate Tracking Format</span>
          <input type="checkbox" id="isolate-tracking-chk" ${isolateTracking ? 'checked' : ''} />
        </div>
        <div class="filter-checkbox-row">
          <span>Exclusion Keywords Block</span>
          <input type="checkbox" id="enable-exclusions-chk" ${enableExclusions ? 'checked' : ''} />
        </div>
        <textarea id="exclude-words-input" style="height: 35px; font-size:9px;" placeholder="Exclusion keywords...">${excludeWords}</textarea>
      </div>

      <!-- HOTKEYS & SPEED CONFIG -->
      <div class="settings-grid">
        <div class="setting-row">
          <label>Hide/Show Shortcut:</label>
          <input type="text" id="toggle-hotkey-input" class="setting-input" value="${toggleHotkey}" readonly />
        </div>
        <div class="setting-row">
          <label>Start Scan Shortcut:</label>
          <input type="text" id="start-hotkey-input" class="setting-input" value="${startHotkey}" readonly />
        </div>
        <div class="setting-row">
          <label>Interval Delay (ms):</label>
          <input type="number" id="delay-input" class="setting-input" style="cursor:text;" value="${scanDelay}" step="100" min="100" />
        </div>
      </div>

      <div class="btn-group">
        <button id="start-btn" class="btn btn-primary">▶ Start</button>
        <button id="pause-btn" class="btn btn-warning" disabled>⏸ Pause</button>
        <button id="stop-btn" class="btn btn-danger" disabled>⏹ Stop</button>
      </div>

      <button id="reset-kill-btn" class="btn btn-reset">🚨 Reset</button>

      <div class="progress-box">
        <div class="status-text">
          <span id="status-label">Status: Idle</span>
          <span id="counter-label">0/0</span>
        </div>
        <div class="progress-bar-bg">
          <div id="progress-fill" class="progress-bar-fill"></div>
        </div>
      </div>
    </div>
  `;

  shadowRoot.appendChild(style);
  shadowRoot.appendChild(panel);

  const barcodeInput = shadowRoot.getElementById('barcode-input');
  const enableRtoAlarmChk = shadowRoot.getElementById('enable-rto-alarm-chk');
  const testSoundBtn = shadowRoot.getElementById('test-sound-btn');
  const isolateChk = shadowRoot.getElementById('isolate-tracking-chk');
  const enableExclusionChk = shadowRoot.getElementById('enable-exclusions-chk');
  const excludeWordsInput = shadowRoot.getElementById('exclude-words-input');

  const startBtn = shadowRoot.getElementById('start-btn');
  const pauseBtn = shadowRoot.getElementById('pause-btn');
  const stopBtn = shadowRoot.getElementById('stop-btn');
  const resetKillBtn = shadowRoot.getElementById('reset-kill-btn');
  const pasteBtn = shadowRoot.getElementById('paste-btn');
  const minimizeBtn = shadowRoot.getElementById('minimize-btn');
  const closeBtn = shadowRoot.getElementById('close-btn');
  const panelBody = shadowRoot.getElementById('panel-body');
  const statusLabel = shadowRoot.getElementById('status-label');
  const counterLabel = shadowRoot.getElementById('counter-label');
  const progressFill = shadowRoot.getElementById('progress-fill');
  const dragHandle = shadowRoot.getElementById('drag-handle');
  
  const toggleHotkeyInput = shadowRoot.getElementById('toggle-hotkey-input');
  const startHotkeyInput = shadowRoot.getElementById('start-hotkey-input');
  const delayInput = shadowRoot.getElementById('delay-input');

  // Trigger update check after loading UI
  setTimeout(checkForUpdates, 2000);

  // ---------------------------------------------------------------------------
  // 5. Filtering Engine
  // ---------------------------------------------------------------------------
  function processAndFilterQueue() {
    const rawText = barcodeInput.value || '';
    const lines = rawText.split(/\s+/).map(s => s.trim()).filter(Boolean);

    const blockedKeywords = excludeWordsInput.value
      .split(/[\n,;\t]+/)
      .map(w => w.trim().toUpperCase())
      .filter(Boolean);

    const filtered = [];
    const seen = new Set();

    for (let segment of lines) {
      let targetValue = segment;
      const upperSegment = segment.toUpperCase();

      if (enableExclusionChk.checked) {
        if (blockedKeywords.some(keyword => upperSegment === keyword || upperSegment.includes(keyword))) {
          continue;
        }
      }

      if (isolateChk.checked) {
        if (TRACKING_ID_EXTRACT_REGEX.test(segment)) {
          targetValue = segment.toUpperCase();
        } else {
          continue;
        }
      }

      if (!seen.has(targetValue)) {
        seen.add(targetValue);
        filtered.push(targetValue);
      }
    }

    trackingQueue = filtered;
    counterLabel.textContent = `0/${trackingQueue.length}`;
  }

  // Event Listeners
  enableRtoAlarmChk.addEventListener('change', () => {
    enableRtoAlarm = enableRtoAlarmChk.checked;
    localStorage.setItem('barcode_enable_rto_alarm', enableRtoAlarm);
  });

  testSoundBtn.addEventListener('click', () => {
    playRTOAlarmSound();
  });

  barcodeInput.addEventListener('input', processAndFilterQueue);
  
  isolateChk.addEventListener('change', () => {
    localStorage.setItem('barcode_isolate_tracking', isolateChk.checked);
    processAndFilterQueue();
  });

  enableExclusionChk.addEventListener('change', () => {
    localStorage.setItem('barcode_enable_exclusions', enableExclusionChk.checked);
    excludeWordsInput.style.display = enableExclusionChk.checked ? 'block' : 'none';
    processAndFilterQueue();
  });

  excludeWordsInput.addEventListener('input', () => {
    localStorage.setItem('barcode_exclude_words', excludeWordsInput.value);
    processAndFilterQueue();
  });

  // Hotkey Recorder & Execution logic...
  let recordingTarget = null;

  function bindHotkeyRecorder(inputEl, keyType) {
    inputEl.addEventListener('click', () => {
      recordingTarget = keyType;
      inputEl.value = "Press keys...";
      inputEl.style.borderColor = "#f59e0b";
    });

    inputEl.addEventListener('keydown', (e) => {
      if (recordingTarget !== keyType) return;
      e.preventDefault();
      e.stopPropagation();

      const keys = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');

      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        keys.push(e.key.toUpperCase());
      }

      if (keys.length > 0 && !['Control', 'Alt', 'Shift'].includes(keys[keys.length - 1])) {
        const formattedHotkey = keys.join(' + ');
        if (keyType === 'toggle') {
          toggleHotkey = formattedHotkey;
          localStorage.setItem('barcode_toggle_hotkey', toggleHotkey);
        } else {
          startHotkey = formattedHotkey;
          localStorage.setItem('barcode_start_hotkey', startHotkey);
        }
        inputEl.value = formattedHotkey;
        inputEl.style.borderColor = "#cbd5e1";
        inputEl.blur();
        recordingTarget = null;
      }
    });

    inputEl.addEventListener('blur', () => {
      if (recordingTarget === keyType) {
        inputEl.value = keyType === 'toggle' ? toggleHotkey : startHotkey;
        inputEl.style.borderColor = "#cbd5e1";
        recordingTarget = null;
      }
    });
  }

  bindHotkeyRecorder(toggleHotkeyInput, 'toggle');
  bindHotkeyRecorder(startHotkeyInput, 'start');

  delayInput.addEventListener('change', () => {
    let val = parseInt(delayInput.value, 10);
    if (isNaN(val) || val < 50) val = 100;
    scanDelay = val;
    delayInput.value = scanDelay;
    localStorage.setItem('barcode_scan_delay', scanDelay);
  });

  window.addEventListener('keydown', (e) => {
    if (recordingTarget) return;

    function checkCombo(comboStr) {
      const parts = comboStr.split(' + ');
      const needCtrl = parts.includes('Ctrl');
      const needAlt = parts.includes('Alt');
      const needShift = parts.includes('Shift');
      const targetKey = parts[parts.length - 1];
      return e.ctrlKey === needCtrl && e.altKey === needAlt && e.shiftKey === needShift && e.key.toUpperCase() === targetKey;
    }

    if (checkCombo(toggleHotkey)) {
      e.preventDefault();
      panel.classList.toggle('panel-hidden');
    }

    if (checkCombo(startHotkey)) {
      e.preventDefault();
      if (!isRunning && !panel.classList.contains('panel-hidden')) {
        startBtn.click();
      }
    }
  });

  closeBtn.addEventListener('click', () => panel.classList.add('panel-hidden'));
  minimizeBtn.addEventListener('click', () => {
    panelBody.classList.toggle('minimized');
    minimizeBtn.textContent = panelBody.classList.contains('minimized') ? '+' : '—';
  });

  let isDragging = false, startX, startY;
  dragHandle.addEventListener('mousedown', (e) => {
    if (e.target === closeBtn || e.target === minimizeBtn) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    panel.style.bottom = 'auto';
    panel.style.right = 'auto';
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    panel.style.left = `${parseFloat(panel.style.left) + dx}px`;
    panel.style.top = `${parseFloat(panel.style.top) + dy}px`;
    startX = e.clientX;
    startY = e.clientY;
  });

  window.addEventListener('mouseup', () => isDragging = false);

  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      barcodeInput.value = text.trim();
      processAndFilterQueue();
    } catch (err) {
      alert("⚠️ Click anywhere on the webpage once to grant clipboard permission.");
    }
  });

  // Hardware Scan Emulation
  async function simulateHardwareScan(element, text) {
    const inputProto = window.HTMLInputElement.prototype;
    const textareaProto = window.HTMLTextAreaElement.prototype;
    const nativeSetter = 
      Object.getOwnPropertyDescriptor(inputProto, 'value')?.set ||
      Object.getOwnPropertyDescriptor(textareaProto, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(element, '');
    } else {
      element.value = '';
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    await new Promise(r => setTimeout(r, 40));

    let currentVal = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charCode = char.charCodeAt(0);
      const codeStr = /[0-9]/.test(char) ? `Digit${char}` : `Key${char.toUpperCase()}`;

      element.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: codeStr, keyCode: charCode, which: charCode, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: codeStr, keyCode: charCode, which: charCode, bubbles: true }));

      currentVal += char;
      if (nativeSetter) {
        nativeSetter.call(element, currentVal);
      } else {
        element.value = currentVal;
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: codeStr, keyCode: charCode, which: charCode, bubbles: true }));

      await new Promise(r => setTimeout(r, 8));
    }

    await new Promise(r => setTimeout(r, 10));

    ['keydown', 'keypress', 'keyup'].forEach(eventType => {
      element.dispatchEvent(new KeyboardEvent(eventType, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    });

    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  resetKillBtn.addEventListener('click', () => {
    shouldStop = true;
    isRunning = false;
    isPaused = false;
    trackingQueue = [];
    currentIndex = 0;
    barcodeInput.value = '';
    startBtn.disabled = false;
    barcodeInput.disabled = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = '⏸ Pause';
    stopBtn.disabled = true;
    statusLabel.textContent = 'Status: Reset 🚨';
    counterLabel.textContent = '0/0';
    progressFill.style.width = '0%';
  });

  startBtn.addEventListener('click', async () => {
    processAndFilterQueue();
    if (trackingQueue.length === 0) {
      alert("⚠️ No valid tracking IDs match your filter settings!");
      return;
    }

    let activeEl = document.activeElement;
    if (activeEl === rootContainer) activeEl = null;
    if (!activeEl || (activeEl.tagName !== 'INPUT' && activeEl.tagName !== 'TEXTAREA')) {
      activeEl = document.querySelector('input[type="text"], input:not([type]), textarea');
    }

    if (!activeEl) {
      alert("⚠️ Click inside the Scan Shipment input field first!");
      return;
    }

    isRunning = true;
    isPaused = false;
    shouldStop = false;

    startBtn.disabled = true;
    barcodeInput.disabled = true;
    pauseBtn.disabled = false;
    stopBtn.disabled = false;

    for (currentIndex = 0; currentIndex < trackingQueue.length; currentIndex++) {
      if (shouldStop) break;

      while (isPaused) {
        statusLabel.textContent = "Status: Paused";
        await new Promise(res => setTimeout(res, 200));
        if (shouldStop) break;
      }
      if (shouldStop) break;

      const tid = trackingQueue[currentIndex];
      statusLabel.textContent = `Injecting: ${tid}`;
      counterLabel.textContent = `${currentIndex + 1}/${trackingQueue.length}`;
      progressFill.style.width = `${((currentIndex + 1) / trackingQueue.length) * 100}%`;

      activeEl.focus();
      activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      await new Promise(res => setTimeout(res, 30));

      await simulateHardwareScan(activeEl, tid);
      await new Promise(res => setTimeout(res, scanDelay));
    }

    isRunning = false;
    startBtn.disabled = false;
    barcodeInput.disabled = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = '⏸ Pause';
    stopBtn.disabled = true;

    statusLabel.textContent = shouldStop ? "Status: Stopped" : "Status: Completed! ✅";
  });

  pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
    if (isPaused) statusLabel.textContent = 'Status: Paused';
  });

  stopBtn.addEventListener('click', () => {
    shouldStop = true;
    statusLabel.textContent = 'Status: Stopping...';
  });
})();
