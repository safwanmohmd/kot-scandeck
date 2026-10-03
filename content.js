(function () {
  // ---------------------------------------------------------------------------
  // 0. Auto-Update Engine Config (GitHub Releases Integration)
  // ---------------------------------------------------------------------------
  const CURRENT_VERSION = "5.0";

  const GITHUB_USER = "safwanmohmd";
  const GITHUB_REPO = "kot-scandeck";

  const VERSION_CHECK_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/version.json`;

  async function checkForUpdates() {
    try {
      const response = await fetch(`${VERSION_CHECK_URL}?t=${Date.now()}`);
      if (!response.ok) return;

      const data = await response.json();
      if (data.latestVersion && data.latestVersion !== CURRENT_VERSION) {
        showUpdateBanner(data.latestVersion, data.downloadUrl);
      }
    } catch (e) {
      console.log("GitHub release version check skipped:", e);
    }
  }

  function showUpdateBanner(newVersion, downloadUrl) {
    const banner = shadowRoot.getElementById('update-banner');
    const textEl = shadowRoot.getElementById('update-banner-text');
    const btn = shadowRoot.getElementById('update-download-btn');

    if (banner && textEl && btn) {
      textEl.textContent = `🚀 New Update Available (v${newVersion})!`;
      banner.style.display = 'flex';
      btn.onclick = () => {
        window.open(downloadUrl, '_blank');
      };
    }
  }

  // Saved Settings for Alarms & Scan Mode
  let enableRtoAlarm = localStorage.getItem('barcode_enable_rto_alarm') === 'true';
  let enableCpdAlarm = localStorage.getItem('barcode_enable_cpd_alarm') === 'true';
  let enablePrcAutomation = localStorage.getItem('barcode_enable_prc_automation') === 'true';

  // Runsheet Saved Settings
  let rsTargetAgent = localStorage.getItem('rs_target_agent') || 'Abdul Basith';
  let rsVehicleType = localStorage.getItem('rs_vehicle_type') || 'Bike';
  let rsActionType = localStorage.getItem('rs_action_type') || 'DRAFT';
  let rsStepDelay = parseInt(localStorage.getItem('rs_step_delay') || '400', 10);

  // ---------------------------------------------------------------------------
  // 1. Custom Audio File Player & Mutual Exclusion Detection Engines
  // ---------------------------------------------------------------------------
  let currentAudioInstance = null;
  let currentCpdAudioInstance = null;

  function playRTOAlarmSound() {
    try {
      if (currentAudioInstance) {
        currentAudioInstance.pause();
        currentAudioInstance.currentTime = 0;
      }

      const soundUrl = chrome.runtime.getURL('alarm.mp3');
      currentAudioInstance = new Audio(soundUrl);
      currentAudioInstance.volume = 1.0;

      const playPromise = currentAudioInstance.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.warn("Audio playback blocked. Click anywhere on the page once to enable audio.", error);
        });
      }
    } catch (e) {
      console.error("Custom RTO Sound Alert failed:", e);
    }
  }

  function playCPDAlarmSound() {
    try {
      if (currentCpdAudioInstance) {
        currentCpdAudioInstance.pause();
        currentCpdAudioInstance.currentTime = 0;
      }

      const soundUrl = chrome.runtime.getURL('cpd_alarm.mp3');
      currentCpdAudioInstance = new Audio(soundUrl);
      currentCpdAudioInstance.volume = 1.0; // 100% Volume

      const playPromise = currentCpdAudioInstance.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          playFallbackBeep();
        });
      }
    } catch (e) {
      playFallbackBeep();
    }
  }

  function playFallbackBeep() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      osc.frequency.setValueAtTime(440, audioCtx.currentTime + 0.15);
      gain.gain.setValueAtTime(1.0, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch (err) {
      console.warn("Fallback beep failed:", err);
    }
  }

  function getTodayDateString() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  let lastAlarmTimestamp = 0;

  function inspectPageForAlerts() {
    const isPanelActive = panel && !panel.classList.contains('panel-hidden');
    if (!isPanelActive) return;

    const elements = Array.from(document.querySelectorAll('.sc-AykKC, .fmcvyS, div, td, tr, span'));

    // Step A: Target exact ERP Styled Component structures for IS RTO
    let isRtoYesDetected = false;
    const rtoLabelNode = elements.find(el => {
      const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
      return text === "IS RTO" || text === "IS RTO:";
    });

    if (rtoLabelNode) {
      const parentCell = rtoLabelNode.closest('.fmcvyS, div, td') || rtoLabelNode.parentElement;
      const containerText = parentCell ? parentCell.textContent.toUpperCase() : '';

      if (containerText.includes('YES') && !containerText.includes('IS RTO CV')) {
        isRtoYesDetected = true;
      }
    } else {
      const bodyText = (document.body.textContent || document.body.innerText || '')
        .replace(/\s+/g, ' ')
        .toUpperCase();
      
      if (bodyText.includes('IS RTO YES')) {
        isRtoYesDetected = true;
      }
    }

    // Step B: Target exact ERP Styled Component structures for CPD
    let isTodayCpdDetected = false;
    const todayStr = getTodayDateString();
    const cpdLabelNode = elements.find(el => {
      const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
      return text === "CPD" || text === "CPD:";
    });

    if (cpdLabelNode) {
      const parentCell = cpdLabelNode.closest('.fmcvyS, div, td') || cpdLabelNode.parentElement;
      const containerText = parentCell ? parentCell.textContent : '';

      if (containerText.includes(todayStr)) {
        isTodayCpdDetected = true;
      }
    }

    // Step C: Priority Triggering
    const now = Date.now();
    if (now - lastAlarmTimestamp > 500) {
      if (isRtoYesDetected && enableRtoAlarm) {
        playRTOAlarmSound();
        lastAlarmTimestamp = now;
      } else if (isTodayCpdDetected && enableCpdAlarm) {
        playCPDAlarmSound();
        lastAlarmTimestamp = now;
      }
    }
  }

  const alertObserver = new MutationObserver(() => {
    inspectPageForAlerts();
  });

  alertObserver.observe(document.body, {
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
  let scanDelay = parseInt(localStorage.getItem('barcode_scan_delay') || '1', 10);
  let isolateTracking = localStorage.getItem('barcode_isolate_tracking') !== 'false';
  let enableExclusions = localStorage.getItem('barcode_enable_exclusions') !== 'false';
  let excludeWords = localStorage.getItem('barcode_exclude_words') || 'FORWARD, UNDELIVERED, FLIPKART, ESCALATION, VERIFICATION, SHIPMENTS, PACKAGING, MANDATORY';

  function toggleExtensionPanel() {
    if (!panel) return;
    panel.classList.toggle('panel-hidden');
    if (!panel.classList.contains('panel-hidden') && panelBody) {
      panelBody.classList.remove('minimized');
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.action === 'TOGGLE_PANEL') {
        toggleExtensionPanel();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 4. Shadow DOM Container Setup & Fluid Scalable Preset Styles
  // ---------------------------------------------------------------------------
  const rootContainer = document.createElement('div');
  rootContainer.id = 'barcode-injector-root';
  document.body.appendChild(rootContainer);

  const shadowRoot = rootContainer.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    * { 
      box-sizing: border-box; 
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
      -webkit-font-smoothing: antialiased;
    }
    
    #panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 280px;
      min-width: 170px;
      max-width: 550px;
      min-height: 120px;
      background: #ffffff;
      border: 1px solid rgba(226, 232, 240, 0.9);
      border-radius: 12px;
      box-shadow: 0 12px 30px -4px rgba(15, 23, 42, 0.16), 0 4px 10px -2px rgba(15, 23, 42, 0.08);
      z-index: 999999;
      overflow: hidden;
      resize: both;
      display: flex;
      flex-direction: column;
      backdrop-filter: blur(10px);
      container-type: inline-size;
      transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    #panel.panel-hidden { 
      display: none !important; 
    }

    .header {
      background: #0f172a;
      color: #ffffff;
      padding: clamp(4px, 2cqw, 7px) clamp(6px, 3cqw, 10px);
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: move;
      user-select: none;
      flex-shrink: 0;
      border-bottom: 1px solid #1e293b;
    }
    .header-title { 
      font-weight: 700; 
      font-size: clamp(8.5px, 2.8cqw, 10.5px); 
      letter-spacing: 0.3px; 
      display: flex; 
      align-items: center; 
      gap: 4px; 
      color: #f8fafc;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .header-btns { display: flex; gap: clamp(2px, 1.2cqw, 5px); align-items: center; flex-shrink: 0; }
    .header-btns button {
      background: rgba(255, 255, 255, 0.08); 
      border: none; 
      color: #94a3b8; 
      width: clamp(14px, 4.5cqw, 18px); 
      height: clamp(14px, 4.5cqw, 18px); 
      border-radius: 3px; 
      font-size: clamp(7.5px, 2.5cqw, 9.5px); 
      cursor: pointer; 
      display: flex; 
      align-items: center; 
      justify-content: center;
      transition: all 0.15s ease;
      padding: 0;
    }
    .header-btns button:hover { 
      background: rgba(255, 255, 255, 0.2); 
      color: #ffffff; 
    }

    /* Seamless Segmented Tab Switch Bar */
    .tab-bar {
      display: flex;
      background: #f1f5f9;
      padding: 2px;
      border-bottom: 1px solid #e2e8f0;
      user-select: none;
    }
    .tab-btn {
      flex: 1;
      text-align: center;
      padding: 4px 6px;
      font-size: clamp(7.5px, 2.4cqw, 9.5px);
      font-weight: 700;
      border: none;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .tab-btn.active {
      background: #ffffff;
      color: #1e40af;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }

    .body { 
      padding: clamp(5px, 2.5cqw, 9px); 
      display: flex; 
      flex-direction: column; 
      gap: clamp(4px, 2cqw, 7px); 
      overflow-y: auto; 
      flex-grow: 1; 
      background: #ffffff;
      position: relative;
    }
    .body.minimized { display: none; }
    
    .tab-content {
      display: flex;
      flex-direction: column;
      gap: clamp(4px, 2cqw, 7px);
    }
    .hidden-tab { display: none !important; }

    .update-banner {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
      padding: 3px 6px;
      border-radius: 4px;
      display: none;
      align-items: center;
      justify-content: space-between;
      font-size: clamp(7px, 2.3cqw, 9px);
      font-weight: 700;
    }
    .btn-update-dl {
      background: #f59e0b;
      color: white;
      border: none;
      padding: 2px 5px;
      border-radius: 3px;
      cursor: pointer;
      font-size: clamp(7px, 2.3cqw, 9px);
      font-weight: 600;
    }
    .btn-update-dl:hover { background: #d97706; }

    label { 
      font-size: clamp(7px, 2.3cqw, 9px); 
      font-weight: 700; 
      color: #64748b; 
      text-transform: uppercase; 
      letter-spacing: 0.3px; 
    }
    
    textarea {
      width: 100%; 
      height: clamp(30px, 14cqw, 48px); 
      padding: clamp(3px, 1.5cqw, 6px); 
      border: 1px solid #cbd5e1; 
      border-radius: 5px;
      font-size: clamp(8px, 2.6cqw, 10px); 
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; 
      resize: vertical; 
      outline: none;
      background: #f8fafc;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    textarea:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
      background: #ffffff;
    }

    .btn-group { display: flex; gap: clamp(3px, 1.3cqw, 5px); }
    button.btn {
      flex: 1; 
      padding: clamp(3px, 1.4cqw, 5px) clamp(3px, 1.2cqw, 5px); 
      border: none; 
      border-radius: 5px; 
      font-weight: 600; 
      font-size: clamp(7.5px, 2.5cqw, 10px);
      cursor: pointer; 
      transition: all 0.15s ease; 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      gap: 3px;
      white-space: nowrap;
    }
    .btn:active { transform: scale(0.98); }
    .btn-primary { background: #2563eb; color: white; box-shadow: 0 1px 4px rgba(37, 99, 235, 0.2); }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-warning { background: #f59e0b; color: white; }
    .btn-warning:hover { background: #d97706; }
    .btn-danger { background: #ef4444; color: white; }
    .btn-danger:hover { background: #dc2626; }
    .btn-reset { 
      background: #fee2e2; 
      color: #b91c1c; 
      border: 1px solid #fca5a5; 
      width: 100%; 
      font-weight: 700; 
      padding: clamp(3px, 1.4cqw, 5px); 
      font-size: clamp(7.5px, 2.5cqw, 10px);
      border-radius: 5px; 
    }
    .btn-reset:hover { background: #fecaca; }
    .btn-secondary { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; }
    .btn-secondary:hover { background: #e2e8f0; }
    button:disabled { opacity: 0.45; cursor: not-allowed; transform: none !important; }

    .progress-box { 
      background: #f8fafc; 
      border: 1px solid #e2e8f0; 
      border-radius: 5px; 
      padding: clamp(3px, 1.6cqw, 6px) clamp(5px, 2cqw, 8px); 
    }
    .progress-bar-bg { 
      background: #e2e8f0; 
      height: clamp(3px, 1cqw, 5px); 
      border-radius: 3px; 
      overflow: hidden; 
      margin-top: 3px; 
    }
    .progress-bar-fill { 
      background: linear-gradient(90deg, #2563eb, #3b82f6); 
      height: 100%; 
      width: 0%; 
      border-radius: 3px; 
      transition: width 0.25s ease-out; 
    }
    .status-text { 
      font-size: clamp(7px, 2.3cqw, 9px); 
      color: #64748b; 
      font-weight: 600; 
      display: flex; 
      justify-content: space-between; 
    }

    /* Card Sections */
    .filter-section {
      background: #f8fafc; 
      border: 1px solid #e2e8f0; 
      border-radius: 7px; 
      padding: clamp(3px, 1.6cqw, 6px);
      display: flex; 
      flex-direction: column; 
      gap: clamp(3px, 1.4cqw, 5px);
    }
    
    .setting-row { 
      display: flex; 
      justify-content: space-between; 
      align-items: center; 
    }
    .setting-input {
      background: #ffffff; 
      border: 1px solid #cbd5e1; 
      border-radius: 3px; 
      padding: clamp(1px, 0.6cqw, 2px) clamp(3px, 1.2cqw, 5px);
      font-size: clamp(7px, 2.3cqw, 9.5px); 
      font-weight: 700; 
      color: #2563eb; 
      width: clamp(50px, 22cqw, 85px); 
      text-align: center; 
      cursor: pointer;
      outline: none;
      transition: border-color 0.15s;
    }
    .setting-input:focus { border-color: #2563eb; }

    /* Switch Component */
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1px 0;
      user-select: none;
    }
    .switch-title {
      font-size: clamp(7px, 2.4cqw, 9.5px);
      font-weight: 600;
      color: #334155;
      display: flex;
      align-items: center;
      gap: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .smooth-switch {
      position: relative;
      display: inline-block;
      width: clamp(20px, 7.5cqw, 28px);
      height: clamp(11px, 4cqw, 16px);
      flex-shrink: 0;
    }
    .smooth-switch input {
      opacity: 0;
      width: 0;
      height: 0;
      margin: 0;
      position: absolute;
    }
    .switch-slider {
      position: absolute;
      cursor: pointer;
      top: 0; left: 0; right: 0; bottom: 0;
      background-color: #cbd5e1;
      transition: background-color 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      border-radius: 20px;
    }
    .switch-slider::before {
      position: absolute;
      content: "";
      height: clamp(7px, 2.8cqw, 12px);
      width: clamp(7px, 2.8cqw, 12px);
      left: 2px;
      bottom: 2px;
      background-color: #ffffff;
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.15s ease;
      border-radius: 50%;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    .smooth-switch input:checked + .switch-slider {
      background-color: #2563eb;
    }
    .smooth-switch input:checked + .switch-slider::before {
      transform: translateX(clamp(7px, 3.2cqw, 12px));
    }

    /* Emerald Theme for CPD */
    .cpd-card {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 5px;
      padding: clamp(2px, 1.2cqw, 4px) clamp(3px, 1.6cqw, 6px);
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .cpd-card .switch-title {
      color: #15803d;
      font-weight: 700;
    }
    .cpd-switch input:checked + .switch-slider {
      background-color: #059669 !important;
    }
    .btn-cpd-action {
      background: #ffffff;
      color: #047857;
      border: 1px solid #a7f3d0;
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(5, 150, 105, 0.08);
    }
    .btn-cpd-action:hover {
      background: #ecfdf5;
      border-color: #6ee7b7;
    }

    /* Purple Accent for PRC Automation Mode */
    .prc-card {
      background: #faf5ff;
      border: 1px solid #e9d5ff;
      border-radius: 5px;
      padding: clamp(2px, 1.2cqw, 4px) clamp(3px, 1.6cqw, 6px);
    }
    .prc-card .switch-title {
      color: #7e22ce;
      font-weight: 700;
    }
    .prc-switch input:checked + .switch-slider {
      background-color: #9333ea !important;
    }

    /* Settings Gear Button */
    .btn-gear-settings {
      background: none;
      border: 1px solid #cbd5e1;
      border-radius: 3px;
      color: #64748b;
      cursor: pointer;
      padding: 1px 3px;
      font-size: clamp(7px, 2.2cqw, 9px);
      line-height: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      white-space: nowrap;
    }
    .btn-gear-settings:hover {
      background: #e2e8f0;
      color: #0f172a;
    }

    /* Exclusion Words Modal */
    .modal-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.5);
      backdrop-filter: blur(2px);
      z-index: 1000;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 10px;
    }
    .modal-overlay.open {
      display: flex;
    }
    .modal-card {
      background: #ffffff;
      border-radius: 7px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 10px 25px rgba(0,0,0,0.2);
      width: 100%;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-title {
      font-size: clamp(7.5px, 2.5cqw, 10px);
      font-weight: 700;
      color: #1e293b;
    }
    .modal-close-btn {
      background: none;
      border: none;
      color: #94a3b8;
      font-size: clamp(8.5px, 2.8cqw, 11px);
      cursor: pointer;
      padding: 0 2px;
    }
    .modal-close-btn:hover {
      color: #0f172a;
    }

    .settings-grid {
      background: #f8fafc; 
      border: 1px solid #e2e8f0; 
      border-radius: 6px; 
      padding: clamp(3px, 1.6cqw, 6px);
      display: flex; 
      flex-direction: column; 
      gap: clamp(2px, 1.3cqw, 5px);
    }

    @container (max-width: 210px) {
      .setting-row label {
        display: none;
      }
      .setting-row {
        justify-content: flex-end;
      }
      .setting-input {
        width: 100%;
      }
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

    <!-- Segmented Tab Switcher Hook -->
    <div class="tab-bar">
      <button id="tab-btn-scanner" class="tab-btn active">⚡ Scanner</button>
    </div>

    <div class="body" id="panel-body">
      <div id="update-banner" class="update-banner">
        <span id="update-banner-text">🚀 New Update Available!</span>
        <button id="update-download-btn" class="btn-update-dl">📥 Get</button>
      </div>

      <!-- TAB 1: SCANNER VIEW -->
      <div id="tab-content-scanner" class="tab-content">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
            <label>Raw Data Input</label>
            <div style="display:flex; gap:3px;">
              <button id="copy-btn" class="btn btn-secondary" style="padding: 1px 5px; font-size: clamp(7px, 2.3cqw, 8.5px); border-radius:3px;" title="Copy filtered tracking IDs">📄 Copy</button>
              <button id="paste-btn" class="btn btn-secondary" style="padding: 1px 5px; font-size: clamp(7px, 2.3cqw, 8.5px); border-radius:3px;">📋 Paste</button>
            </div>
          </div>
          <textarea id="barcode-input" placeholder="Paste manifest / logs here..."></textarea>
        </div>

        <div class="filter-section">
          <!-- RTO Alarm Switch -->
          <div class="switch-row">
            <span class="switch-title">🔊 RTO Alarm</span>
            <label class="smooth-switch">
              <input type="checkbox" id="enable-rto-alarm-chk" ${enableRtoAlarm ? 'checked' : ''} />
              <span class="switch-slider"></span>
            </label>
          </div>

          <div class="setting-row">
            <label style="text-transform:none; font-size: clamp(6.5px, 2.2cqw, 9px);">RTO Audio Test:</label>
            <button id="test-sound-btn" class="btn btn-secondary" style="padding: 1px 5px; font-size: clamp(7px, 2.3cqw, 8.5px); border-radius:3px;" title="Test Audio">🔊 Test</button>
          </div>

          <!-- CPD Alarm Emerald Toggle Card -->
          <div class="cpd-card">
            <div class="switch-row">
              <span class="switch-title">📅 Today CPD Alarm</span>
              <label class="smooth-switch cpd-switch">
                <input type="checkbox" id="enable-cpd-alarm-chk" ${enableCpdAlarm ? 'checked' : ''} />
                <span class="switch-slider"></span>
              </label>
            </div>

            <div class="setting-row">
              <label style="text-transform:none; font-size: clamp(6.5px, 2.2cqw, 9px); color: #15803d;">CPD Audio Test:</label>
              <button id="test-cpd-sound-btn" class="btn btn-cpd-action" style="padding: 1px 5px; font-size: clamp(7px, 2.3cqw, 8.5px); border-radius:3px;" title="Test CPD Audio">🎵 Test</button>
            </div>
          </div>

          <!-- Mode Toggle: PRC AUTOMATION -->
          <div class="prc-card">
            <div class="switch-row">
              <span class="switch-title" title="Enable for ERP Dashboard scanning to bypass anti-manual blocks. Disable for normal extreme speed injection.">⚙️ PRC AUTOMATION</span>
              <label class="smooth-switch prc-switch">
                <input type="checkbox" id="enable-prc-automation-chk" ${enablePrcAutomation ? 'checked' : ''} />
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>

          <!-- Tracking Isolator Switch -->
          <div class="switch-row">
            <span class="switch-title">Isolate Tracking</span>
            <label class="smooth-switch">
              <input type="checkbox" id="isolate-tracking-chk" ${isolateTracking ? 'checked' : ''} />
              <span class="switch-slider"></span>
            </label>
          </div>

          <!-- Keywords Exclusion Switch & Settings Button -->
          <div class="switch-row">
            <div style="display: flex; align-items: center; gap: 3px; overflow: hidden;">
              <span class="switch-title">Keywords Block</span>
              <button id="open-exclusions-btn" class="btn-gear-settings" title="Edit exclusion keywords">⚙️</button>
            </div>
            <label class="smooth-switch">
              <input type="checkbox" id="enable-exclusions-chk" ${enableExclusions ? 'checked' : ''} />
              <span class="switch-slider"></span>
            </label>
          </div>
        </div>

        <!-- Exclusion Keywords Modal -->
        <div id="exclusions-modal" class="modal-overlay">
          <div class="modal-card">
            <div class="modal-header">
              <span class="modal-title">⚙️ Exclusion Keywords</span>
              <button id="close-modal-btn" class="modal-close-btn" title="Close">✕</button>
            </div>
            <label style="font-size: 8px; text-transform: none; color: #64748b;">Separate keywords using commas, semicolons, or lines:</label>
            <textarea id="exclude-words-input" style="height: 55px; font-size: 9px;" placeholder="Exclusion keywords...">${excludeWords}</textarea>
            <button id="save-modal-btn" class="btn btn-primary" style="padding: 3px; font-size: 8.5px;">Done</button>
          </div>
        </div>

        <div class="settings-grid">
          <div class="setting-row">
            <label>Hide/Show:</label>
            <input type="text" id="toggle-hotkey-input" class="setting-input" value="${toggleHotkey}" readonly />
          </div>
          <div class="setting-row">
            <label>Start Scan:</label>
            <input type="text" id="start-hotkey-input" class="setting-input" value="${startHotkey}" readonly />
          </div>
          <div class="setting-row">
            <label>Delay (ms):</label>
            <input type="number" id="delay-input" class="setting-input" style="cursor:text;" value="${scanDelay}" step="1" min="1" />
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
    </div>
  `;

  shadowRoot.appendChild(style);
  shadowRoot.appendChild(panel);

  const barcodeInput = shadowRoot.getElementById('barcode-input');
  const enableRtoAlarmChk = shadowRoot.getElementById('enable-rto-alarm-chk');
  const enableCpdAlarmChk = shadowRoot.getElementById('enable-cpd-alarm-chk');
  const enablePrcAutomationChk = shadowRoot.getElementById('enable-prc-automation-chk');
  const testSoundBtn = shadowRoot.getElementById('test-sound-btn');
  const testCpdSoundBtn = shadowRoot.getElementById('test-cpd-sound-btn');
  const isolateChk = shadowRoot.getElementById('isolate-tracking-chk');
  const enableExclusionChk = shadowRoot.getElementById('enable-exclusions-chk');
  const excludeWordsInput = shadowRoot.getElementById('exclude-words-input');

  const exclusionsModal = shadowRoot.getElementById('exclusions-modal');
  const openExclusionsBtn = shadowRoot.getElementById('open-exclusions-btn');
  const closeModalBtn = shadowRoot.getElementById('close-modal-btn');
  const saveModalBtn = shadowRoot.getElementById('save-modal-btn');

  const startBtn = shadowRoot.getElementById('start-btn');
  const pauseBtn = shadowRoot.getElementById('pause-btn');
  const stopBtn = shadowRoot.getElementById('stop-btn');
  const resetKillBtn = shadowRoot.getElementById('reset-kill-btn');
  const copyBtn = shadowRoot.getElementById('copy-btn');
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

  enableRtoAlarmChk.addEventListener('change', () => {
    enableRtoAlarm = enableRtoAlarmChk.checked;
    localStorage.setItem('barcode_enable_rto_alarm', enableRtoAlarm);
  });

  enableCpdAlarmChk.addEventListener('change', () => {
    enableCpdAlarm = enableCpdAlarmChk.checked;
    localStorage.setItem('barcode_enable_cpd_alarm', enableCpdAlarm);
  });

  enablePrcAutomationChk.addEventListener('change', () => {
    enablePrcAutomation = enablePrcAutomationChk.checked;
    localStorage.setItem('barcode_enable_prc_automation', enablePrcAutomation);
  });

  testSoundBtn.addEventListener('click', () => {
    playRTOAlarmSound();
  });

  testCpdSoundBtn.addEventListener('click', () => {
    playCPDAlarmSound();
  });

  barcodeInput.addEventListener('input', processAndFilterQueue);
  
  isolateChk.addEventListener('change', () => {
    localStorage.setItem('barcode_isolate_tracking', isolateChk.checked);
    processAndFilterQueue();
  });

  enableExclusionChk.addEventListener('change', () => {
    localStorage.setItem('barcode_enable_exclusions', enableExclusionChk.checked);
    processAndFilterQueue();
  });

  excludeWordsInput.addEventListener('input', () => {
    localStorage.setItem('barcode_exclude_words', excludeWordsInput.value);
    processAndFilterQueue();
  });

  // Settings Modal Controls
  openExclusionsBtn.addEventListener('click', () => {
    exclusionsModal.classList.add('open');
    excludeWordsInput.focus();
  });

  closeModalBtn.addEventListener('click', () => {
    exclusionsModal.classList.remove('open');
  });

  saveModalBtn.addEventListener('click', () => {
    exclusionsModal.classList.remove('open');
  });

  // ---------------------------------------------------------------------------
  // 6. Hotkeys & UI Interaction
  // ---------------------------------------------------------------------------
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
    if (isNaN(val) || val < 1) val = 1;
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

  copyBtn.addEventListener('click', async () => {
    processAndFilterQueue();
    if (trackingQueue.length === 0) {
      alert("⚠️ No filtered tracking IDs to copy!");
      return;
    }
    try {
      await navigator.clipboard.writeText(trackingQueue.join('\n'));
      const originalText = copyBtn.textContent;
      copyBtn.textContent = '✅ Copied!';
      copyBtn.style.color = '#15803d';
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.color = '';
      }, 1500);
    } catch (err) {
      alert("⚠️ Click anywhere on the webpage once to grant clipboard permission.");
    }
  });

  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      barcodeInput.value = text.trim();
      processAndFilterQueue();
    } catch (err) {
      alert("⚠️ Click anywhere on the webpage once to grant clipboard permission.");
    }
  });

  // ---------------------------------------------------------------------------
  // 7. Dual Engine: Instant Extreme Speed VS PRC AUTOMATION (Hardware Emulation)
  // ---------------------------------------------------------------------------
  async function simulateHardwareScan(element, text) {
    const inputProto = window.HTMLInputElement.prototype;
    const textareaProto = window.HTMLTextAreaElement.prototype;
    const nativeSetter = 
      Object.getOwnPropertyDescriptor(inputProto, 'value')?.set ||
      Object.getOwnPropertyDescriptor(textareaProto, 'value')?.set;

    // --- MODE 1: NORMAL SCANNING (EXTREME SPEED - Instant Injection) ---
    if (!enablePrcAutomation) {
      if (nativeSetter) {
        nativeSetter.call(element, text);
      } else {
        element.value = text;
      }

      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      ['keydown', 'keypress', 'keyup'].forEach(eventType => {
        element.dispatchEvent(new KeyboardEvent(eventType, {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true
        }));
      });
      return;
    }

    // --- MODE 2: PRC AUTOMATION (Authentic Hardware Keystrokes for ERP Dashboard) ---
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

  // Execution Controls
  if (resetKillBtn) {
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
  }

  if (startBtn) {
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
        
        // Escape clear only in PRC Automation mode
        if (enablePrcAutomation) {
          activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
          await new Promise(res => setTimeout(res, 30));
        }

        await simulateHardwareScan(activeEl, tid);
        
        if (scanDelay > 0) {
          await new Promise(res => setTimeout(res, scanDelay));
        }
      }

      isRunning = false;
      startBtn.disabled = false;
      barcodeInput.disabled = false;
      pauseBtn.disabled = true;
      pauseBtn.textContent = '⏸ Pause';
      stopBtn.disabled = true;

      statusLabel.textContent = shouldStop ? "Status: Stopped" : "Status: Completed! ✅";
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      pauseBtn.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
      if (isPaused) statusLabel.textContent = 'Status: Paused';
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      shouldStop = true;
      statusLabel.textContent = 'Status: Stopping...';
    });
  }

  // ---------------------------------------------------------------------------
  // 8. Connect External Auto-Runsheet Engine Module (runsheet.js)
  // ---------------------------------------------------------------------------
  if (window.KOT_RunsheetModule && typeof window.KOT_RunsheetModule.mount === 'function') {
    window.KOT_RunsheetModule.mount(shadowRoot);
  }
})();