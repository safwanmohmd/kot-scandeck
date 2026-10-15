// =============================================================================
// KOT-ScanDeck: Standalone Auto-Runsheet Engine (v7.6 - Same-Tab Sticky Focus)
// =============================================================================

window.KOT_RunsheetModule = (function () {
  let isRsRunning = false;
  let isRsPaused = false;
  let shouldRsStop = false;
  let rsQueue = [];
  let currentRsIndex = 0;

  let rsTargetAgent = localStorage.getItem('rs_target_agent') || 'Abdul Basith';
  let rsVehicleType = localStorage.getItem('rs_vehicle_type') || 'Bike';
  let rsActionType = localStorage.getItem('rs_action_type') || 'DRAFT';
  let rsStepDelay = parseInt(localStorage.getItem('rs_step_delay') || '500', 10);
  let rsScheduleEnabled = localStorage.getItem('rs_schedule_enabled') === 'true';

  let rsBarcodeCache = localStorage.getItem('rs_barcode_cache') || '';

  let rsStartHour = localStorage.getItem('rs_start_hour') || '09';
  let rsStartMin = localStorage.getItem('rs_start_min') || '00';
  let rsStartAmPm = localStorage.getItem('rs_start_ampm') || 'AM';

  let rsEndHour = localStorage.getItem('rs_end_hour') || '10';
  let rsEndMin = localStorage.getItem('rs_end_min') || '00';
  let rsEndAmPm = localStorage.getItem('rs_end_ampm') || 'AM';

  let rsScheduleTimer = null;
  let currentShadowRoot = null;

  function lockThisTab() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'LOCK_RUNSHEET_TAB' });
      }
    } catch (e) {}
  }

  function unlockThisTab() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'UNLOCK_RUNSHEET_TAB' });
      }
    } catch (e) {}
  }

  function pulseLock() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'KEEP_ALIVE_PULSE' });
      }
    } catch (e) {}
  }

  const tabStyles = `
    .tab-btn.rs-active {
      background: #4338ca !important;
      color: #ffffff !important;
      box-shadow: 0 1px 3px rgba(67, 56, 202, 0.3) !important;
    }
    .rs-card {
      background: #f8fafc !important;
      border: 1px solid #e2e8f0 !important;
      border-radius: 8px;
      padding: 7px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .rs-card label {
      color: #475569 !important;
      font-weight: 700;
      font-size: 8px;
      letter-spacing: 0.3px;
      text-transform: uppercase;
    }
    .rs-select, 
    #rs-agent-input, 
    #rs-vehicle-select, 
    #rs-action-select, 
    #rs-delay-input {
      background-color: #ffffff !important;
      color: #0f172a !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 5px;
      padding: 3px 6px;
      font-size: 9px;
      font-weight: 600;
      outline: none;
      width: 100%;
      caret-color: #4338ca !important;
      transition: all 0.15s ease;
    }
    .rs-select:focus,
    #rs-agent-input:focus,
    #rs-vehicle-select:focus,
    #rs-action-select:focus,
    #rs-delay-input:focus {
      border-color: #6366f1 !important;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15) !important;
      background-color: #ffffff !important;
      color: #0f172a !important;
    }
    #rs-barcode-input {
      background-color: #f8fafc !important;
      color: #0f172a !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 6px;
      padding: 5px 7px;
      font-size: 9.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 600;
      outline: none;
      caret-color: #4338ca !important;
      height: 60px;
      width: 100%;
      resize: vertical;
      transition: border-color 0.15s;
    }
    #rs-barcode-input:focus {
      background-color: #ffffff !important;
      border-color: #6366f1 !important;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15) !important;
      color: #0f172a !important;
    }
    #rs-barcode-input::placeholder {
      color: #94a3b8 !important;
      font-weight: 500;
    }
    .btn-indigo-theme {
      background: linear-gradient(135deg, #4f46e5, #4338ca) !important;
      color: #ffffff !important;
      box-shadow: 0 2px 5px rgba(67, 56, 202, 0.25);
      border: none;
      font-weight: 700;
    }
    .btn-indigo-theme:hover {
      background: linear-gradient(135deg, #4338ca, #3730a3) !important;
    }
    .progress-bar-fill.indigo {
      background: linear-gradient(90deg, #6366f1, #8b5cf6) !important;
    }
    .rs-status-box {
      background: #f8fafc !important;
      border: 1px solid #e2e8f0 !important;
    }
    .rs-schedule-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 5px 7px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .rs-schedule-card.active {
      border-color: #c7d2fe;
      background: #f5f3ff;
    }
    .rs-schedule-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      user-select: none;
    }
    .rs-schedule-header label {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 0;
      text-transform: none !important;
      font-size: 8.5px !important;
      color: #334155 !important;
    }
    .time-picker-pill {
      display: inline-flex;
      align-items: center;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 1px 3px;
      gap: 2px;
      height: 22px;
      transition: border-color 0.15s;
    }
    .time-picker-pill:focus-within {
      border-color: #6366f1;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
    }
    .time-picker-pill input.typeable-time {
      border: none !important;
      background: transparent !important;
      color: #0f172a !important;
      font-size: 9px !important;
      font-weight: 700 !important;
      outline: none !important;
      text-align: center;
      width: 17px !important;
      padding: 0 !important;
      font-family: inherit;
    }
    .time-picker-pill input.typeable-time::-webkit-inner-spin-button,
    .time-picker-pill input.typeable-time::-webkit-outer-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .time-picker-pill select.ampm-select {
      border: none !important;
      background: #f1f5f9 !important;
      color: #4338ca !important;
      font-size: 8px !important;
      font-weight: 800 !important;
      outline: none !important;
      cursor: pointer;
      padding: 1px 3px !important;
      border-radius: 3px;
      margin-left: 2px;
    }
    .time-sep {
      font-size: 8.5px;
      font-weight: 700;
      color: #64748b;
      margin-top: -1px;
    }
    .countdown-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 2px;
      border-top: 1px dashed #e2e8f0;
      margin-top: 2px;
    }
    .countdown-item {
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .countdown-lbl {
      font-size: 7.5px;
      font-weight: 600;
      color: #64748b;
    }
    .countdown-val {
      font-size: 8px;
      font-weight: 700;
    }
  `;

  function renderRunsheetHTML() {
    return `
      <div class="rs-card">
        <label>Assigned Wishmaster</label>
        <input type="text" id="rs-agent-input" class="rs-select" value="${rsTargetAgent}" placeholder="Enter Wishmaster Name or ID..." />
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
          <div>
            <label>Vehicle Type:</label>
            <select id="rs-vehicle-select" class="rs-select">
              <option value="Bike" ${rsVehicleType === 'Bike' ? 'selected' : ''}>Bike</option>
              <option value="Van" ${rsVehicleType === 'Van' ? 'selected' : ''}>Van</option>
              <option value="Auto" ${rsVehicleType === 'Auto' ? 'selected' : ''}>Auto</option>
              <option value="Electric Scooter (EV)" ${rsVehicleType === 'Electric Scooter (EV)' ? 'selected' : ''}>EV</option>
            </select>
          </div>
          <div>
            <label>Save Mode:</label>
            <select id="rs-action-select" class="rs-select">
              <option value="DRAFT" ${rsActionType === 'DRAFT' ? 'selected' : ''}>Save (Draft)</option>
              <option value="CONFIRM" ${rsActionType === 'CONFIRM' ? 'selected' : ''}>Save & Confirm</option>
            </select>
          </div>
        </div>

        <div style="margin-top:2px;">
          <label>Step Delay (ms):</label>
          <input type="number" id="rs-delay-input" class="rs-select" value="${rsStepDelay}" step="50" min="200" />
        </div>

        <div id="rs-schedule-card-wrapper" class="rs-schedule-card ${rsScheduleEnabled ? 'active' : ''}">
          <div class="rs-schedule-header">
            <label for="rs-schedule-toggle">
              <input type="checkbox" id="rs-schedule-toggle" ${rsScheduleEnabled ? 'checked' : ''} style="cursor:pointer;" />
              <span>⏰ Auto-Schedule Runsheet</span>
            </label>
            <span id="rs-schedule-badge" style="font-size:7.5px; font-weight:700; color:${rsScheduleEnabled ? '#4338ca' : '#94a3b8'};">
              ${rsScheduleEnabled ? 'ACTIVE' : 'OFF'}
            </span>
          </div>
          
          <div id="rs-schedule-config" style="display:${rsScheduleEnabled ? 'flex' : 'none'}; flex-direction:column; gap:4px; margin-top:2px;">
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:5px;">
              <div>
                <label style="font-size:7px; color:#6366f1;">Start At:</label>
                <div class="time-picker-pill">
                  <input type="text" id="rs-start-hour" class="typeable-time" maxlength="2" value="${rsStartHour}" placeholder="HH" />
                  <span class="time-sep">:</span>
                  <input type="text" id="rs-start-min" class="typeable-time" maxlength="2" value="${rsStartMin}" placeholder="MM" />
                  <select id="rs-start-ampm" class="ampm-select">
                    <option value="AM" ${rsStartAmPm === 'AM' ? 'selected' : ''}>AM</option>
                    <option value="PM" ${rsStartAmPm === 'PM' ? 'selected' : ''}>PM</option>
                  </select>
                </div>
              </div>

              <div>
                <label style="font-size:7px; color:#dc2626;">Stop At:</label>
                <div class="time-picker-pill">
                  <input type="text" id="rs-end-hour" class="typeable-time" maxlength="2" value="${rsEndHour}" placeholder="HH" />
                  <span class="time-sep">:</span>
                  <input type="text" id="rs-end-min" class="typeable-time" maxlength="2" value="${rsEndMin}" placeholder="MM" />
                  <select id="rs-end-ampm" class="ampm-select">
                    <option value="AM" ${rsEndAmPm === 'AM' ? 'selected' : ''}>AM</option>
                    <option value="PM" ${rsEndAmPm === 'PM' ? 'selected' : ''}>PM</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="countdown-strip">
              <div class="countdown-item">
                <span class="countdown-lbl">Starts in:</span>
                <span id="rs-schedule-countdown" class="countdown-val" style="color:#4338ca;">--:--</span>
              </div>
              <div class="countdown-item">
                <span class="countdown-lbl">Ends in:</span>
                <span id="rs-schedule-end-countdown" class="countdown-val" style="color:#b91c1c;">--:--</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
          <label style="color:#4338ca;">Bulk Tracking IDs (1 Per Runsheet)</label>
          <span id="rs-queue-counter" style="font-size:8px; font-weight:700; color:#6366f1;">0 detected</span>
        </div>
        <textarea id="rs-barcode-input" placeholder="Paste tracking IDs (1 per line or space separated)...">${rsBarcodeCache}</textarea>
      </div>

      <div class="btn-group">
        <button id="rs-start-btn" class="btn btn-indigo-theme">🚀 Auto-Create Runsheets</button>
        <button id="rs-pause-btn" class="btn btn-warning" disabled>⏸</button>
        <button id="rs-stop-btn" class="btn btn-danger" disabled>⏹</button>
      </div>

      <div class="progress-box rs-status-box">
        <div class="status-text">
          <span id="rs-status-label" style="color:#4338ca;">Runsheet: Idle</span>
          <span id="rs-counter-label" style="color:#6d28d9;">0/0</span>
        </div>
        <div class="progress-bar-bg" style="background:#ddd6fe;">
          <div id="rs-progress-fill" class="progress-bar-fill indigo"></div>
        </div>
      </div>
    `;
  }

  function get24Hour(hour12Str, ampmStr) {
    let h = parseInt(hour12Str, 10);
    if (isNaN(h)) h = 12;
    if (ampmStr === 'AM') {
      if (h === 12) h = 0;
    } else {
      if (h !== 12) h += 12;
    }
    return h;
  }

  function formatDiff(diffMs) {
    const totalSec = Math.max(0, Math.floor(diffMs / 1000));
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function forceShowMenuAndSelectTab() {
    if (!currentShadowRoot) return;
    const panel = currentShadowRoot.getElementById('panel');
    if (panel) panel.classList.remove('panel-hidden');
    const panelBody = currentShadowRoot.getElementById('panel-body');
    if (panelBody) panelBody.classList.remove('minimized');
    const runsheetTabBtn = currentShadowRoot.getElementById('tab-btn-runsheet');
    const runsheetTabContent = currentShadowRoot.getElementById('tab-content-runsheet');
    const scannerTabBtn = currentShadowRoot.getElementById('tab-btn-scanner');
    const scannerTabContent = currentShadowRoot.getElementById('tab-content-scanner');

    if (runsheetTabBtn && runsheetTabContent) {
      runsheetTabBtn.classList.add('active', 'rs-active');
      runsheetTabContent.classList.remove('hidden-tab');
      if (scannerTabBtn) scannerTabBtn.classList.remove('active');
      if (scannerTabContent) scannerTabContent.classList.add('hidden-tab');
    }
  }

  async function injectValueIntoInput(inputEl, textValue) {
    if (!inputEl) return false;
    inputEl.removeAttribute('disabled');
    inputEl.disabled = false;
    inputEl.focus();
    inputEl.click();

    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(inputEl, ''); else inputEl.value = '';
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));

    if (setter) setter.call(inputEl, textValue); else inputEl.value = textValue;
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));

    const enterParams = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    inputEl.dispatchEvent(new KeyboardEvent('keydown', enterParams));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', enterParams));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', enterParams));
    return true;
  }

  function dismissLingeringToasts() {
    const closeButtons = document.querySelectorAll('div[data-cy="non-acionable-toast"] button, div[data-cy="toastMessage"] button, .Toastify__close-button');
    closeButtons.forEach(btn => {
      try { btn.click(); } catch (e) {}
    });
  }

  function detectPreScanConflict(currentId) {
    const errorContainers = Array.from(document.querySelectorAll('div[data-cy="non-acionable-toast"], div[data-cy="toastMessage"], div[role="alert"], .Toastify__toast-body'));
    const conflictKeywords = ['ALREADY', 'ACTIVE RUNSHEET', 'NOT PRESENT IN DATABASE', 'DOES NOT EXIST', 'INVALID SHIPMENT'];

    for (const el of errorContainers) {
      if (el.closest('#barcode-injector-root')) continue;
      const txt = (el.innerText || el.textContent || '').trim().toUpperCase();
      if (!txt) continue;

      if (txt.includes('SAVING RUNSHEET')) continue;

      const isConflict = conflictKeywords.some(kw => txt.includes(kw));
      if (isConflict) {
        if (currentId && !txt.includes(currentId.toUpperCase()) && (txt.includes('FMPR') || txt.includes('MDGR') || txt.includes('MYSR'))) {
          continue;
        }
        return txt;
      }
    }
    return null;
  }

  function getSaveButton(mode = 'DRAFT') {
    if (mode === 'CONFIRM') {
      return document.querySelector('button[data-cy="saveAndConfirm"], button[data-testid="confirmRunsheet"]');
    }
    return document.querySelector('button[data-cy="save"], button[data-testid="saveRunsheet"]');
  }

  function clickButtonOnce(btn) {
    if (!btn) return;
    btn.removeAttribute('disabled');
    btn.disabled = false;
    btn.focus();

    const span = btn.querySelector('span');
    if (span) {
      span.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      span.click();
    } else {
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      btn.click();
    }
  }

  function mount(shadowRoot) {
    if (!shadowRoot || shadowRoot.getElementById('tab-btn-runsheet')) return;
    currentShadowRoot = shadowRoot;

    const styleEl = document.createElement('style');
    styleEl.textContent = tabStyles;
    shadowRoot.appendChild(styleEl);

    const tabBar = shadowRoot.querySelector('.tab-bar');
    const bodyEl = shadowRoot.querySelector('#panel-body');
    if (!tabBar || !bodyEl) return;

    const runsheetTabBtn = document.createElement('button');
    runsheetTabBtn.id = 'tab-btn-runsheet';
    runsheetTabBtn.className = 'tab-btn';
    runsheetTabBtn.textContent = '📋 Auto-Runsheet';
    tabBar.appendChild(runsheetTabBtn);

    const runsheetTabContent = document.createElement('div');
    runsheetTabContent.id = 'tab-content-runsheet';
    runsheetTabContent.className = 'tab-content hidden-tab';
    runsheetTabContent.innerHTML = renderRunsheetHTML();
    bodyEl.appendChild(runsheetTabContent);

    const scannerTabBtn = shadowRoot.querySelector('#tab-btn-scanner');
    const scannerTabContent = shadowRoot.querySelector('#tab-content-scanner');

    runsheetTabBtn.addEventListener('click', () => {
      runsheetTabBtn.classList.add('active', 'rs-active');
      scannerTabBtn.classList.remove('active');
      runsheetTabContent.classList.remove('hidden-tab');
      scannerTabContent.classList.add('hidden-tab');
    });

    scannerTabBtn.addEventListener('click', () => {
      scannerTabBtn.classList.add('active');
      runsheetTabBtn.classList.remove('active', 'rs-active');
      scannerTabContent.classList.remove('hidden-tab');
      runsheetTabContent.classList.add('hidden-tab');
    });

    const rsAgentInput = shadowRoot.getElementById('rs-agent-input');
    const rsVehicleSelect = shadowRoot.getElementById('rs-vehicle-select');
    const rsActionSelect = shadowRoot.getElementById('rs-action-select');
    const rsDelayInput = shadowRoot.getElementById('rs-delay-input');
    const rsBarcodeInput = shadowRoot.getElementById('rs-barcode-input');
    const rsQueueCounter = shadowRoot.getElementById('rs-queue-counter');
    const rsStartBtn = shadowRoot.getElementById('rs-start-btn');
    const rsPauseBtn = shadowRoot.getElementById('rs-pause-btn');
    const rsStopBtn = shadowRoot.getElementById('rs-stop-btn');
    const rsStatusLabel = shadowRoot.getElementById('rs-status-label');
    const rsCounterLabel = shadowRoot.getElementById('rs-counter-label');
    const rsProgressFill = shadowRoot.getElementById('rs-progress-fill');

    const rsScheduleCardWrapper = shadowRoot.getElementById('rs-schedule-card-wrapper');
    const rsScheduleToggle = shadowRoot.getElementById('rs-schedule-toggle');
    const rsScheduleConfig = shadowRoot.getElementById('rs-schedule-config');
    const rsScheduleBadge = shadowRoot.getElementById('rs-schedule-badge');
    const rsScheduleCountdown = shadowRoot.getElementById('rs-schedule-countdown');
    const rsScheduleEndCountdown = shadowRoot.getElementById('rs-schedule-end-countdown');

    const rsStartHourInput = shadowRoot.getElementById('rs-start-hour');
    const rsStartMinInput = shadowRoot.getElementById('rs-start-min');
    const rsStartAmPmSelect = shadowRoot.getElementById('rs-start-ampm');

    const rsEndHourInput = shadowRoot.getElementById('rs-end-hour');
    const rsEndMinInput = shadowRoot.getElementById('rs-end-min');
    const rsEndAmPmSelect = shadowRoot.getElementById('rs-end-ampm');

    function parseQueue() {
      const raw = rsBarcodeInput.value || '';
      localStorage.setItem('rs_barcode_cache', raw);
      rsQueue = raw.split(/[\n,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      if (rsQueueCounter) rsQueueCounter.textContent = `${rsQueue.length} detected`;
      if (rsCounterLabel) rsCounterLabel.textContent = `0/${rsQueue.length}`;
    }

    parseQueue();

    rsBarcodeInput.oninput = parseQueue;
    rsAgentInput.onchange = () => { rsTargetAgent = rsAgentInput.value.trim(); localStorage.setItem('rs_target_agent', rsTargetAgent); };
    rsVehicleSelect.onchange = () => { rsVehicleType = rsVehicleSelect.value; localStorage.setItem('rs_vehicle_type', rsVehicleType); };
    rsActionSelect.onchange = () => { rsActionType = rsActionSelect.value; localStorage.setItem('rs_action_type', rsActionType); };
    rsDelayInput.onchange = () => { rsStepDelay = parseInt(rsDelayInput.value, 10) || 500; localStorage.setItem('rs_step_delay', rsStepDelay); };

    function bindTypeableTime(inputEl, maxVal, minVal, storageKey, onUpdate) {
      inputEl.addEventListener('input', () => {
        inputEl.value = inputEl.value.replace(/[^0-9]/g, '');
        if (inputEl.value.length === 2) {
          let num = parseInt(inputEl.value, 10);
          if (num > maxVal) num = maxVal;
          if (num < minVal) num = minVal;
          inputEl.value = String(num).padStart(2, '0');
        }
      });

      inputEl.addEventListener('blur', () => {
        let num = parseInt(inputEl.value, 10);
        if (isNaN(num)) num = minVal;
        if (num > maxVal) num = maxVal;
        if (num < minVal) num = minVal;
        const formatted = String(num).padStart(2, '0');
        inputEl.value = formatted;
        localStorage.setItem(storageKey, formatted);
        onUpdate(formatted);
        checkScheduleTrigger();
      });

      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') inputEl.blur();
      });
    }

    bindTypeableTime(rsStartHourInput, 12, 1, 'rs_start_hour', (val) => { rsStartHour = val; });
    bindTypeableTime(rsStartMinInput, 59, 0, 'rs_start_min', (val) => { rsStartMin = val; });

    bindTypeableTime(rsEndHourInput, 12, 1, 'rs_end_hour', (val) => { rsEndHour = val; });
    bindTypeableTime(rsEndMinInput, 59, 0, 'rs_end_min', (val) => { rsEndMin = val; });

    rsStartAmPmSelect.onchange = () => {
      rsStartAmPm = rsStartAmPmSelect.value;
      localStorage.setItem('rs_start_ampm', rsStartAmPm);
      checkScheduleTrigger();
    };

    rsEndAmPmSelect.onchange = () => {
      rsEndAmPm = rsEndAmPmSelect.value;
      localStorage.setItem('rs_end_ampm', rsEndAmPm);
      checkScheduleTrigger();
    };

    // =========================================================================
    // Core Runsheet Generator: Strictly Same-Tab Locked
    // =========================================================================
    async function startRunsheetExecution() {
      if (isRsRunning) return;

      forceShowMenuAndSelectTab();

      parseQueue();
      if (rsQueue.length === 0) { 
        if (rsStatusLabel) rsStatusLabel.textContent = "Runsheet: No IDs!";
        return; 
      }
      const targetWishmaster = rsAgentInput ? rsAgentInput.value.trim() : rsTargetAgent;
      if (!targetWishmaster) { 
        if (rsStatusLabel) rsStatusLabel.textContent = "Runsheet: No Agent!";
        return; 
      }

      isRsRunning = true; 
      isRsPaused = false; 
      shouldRsStop = false;

      // Lock this tab directly inside the current window
      lockThisTab();

      if (rsStartBtn) rsStartBtn.disabled = true; 
      if (rsBarcodeInput) rsBarcodeInput.disabled = true;
      if (rsPauseBtn) rsPauseBtn.disabled = false; 
      if (rsStopBtn) rsStopBtn.disabled = false;

      let skippedCount = 0, successCount = 0;

      for (currentRsIndex = 0; currentRsIndex < rsQueue.length; currentRsIndex++) {
        if (shouldRsStop) break;

        while (isRsPaused) {
          if (rsStatusLabel) rsStatusLabel.textContent = "Runsheet: Paused";
          await new Promise(res => setTimeout(res, 200));
          if (shouldRsStop) break;
        }
        if (shouldRsStop) break;

        pulseLock();

        const currentTrackingId = rsQueue[currentRsIndex];
        if (rsStatusLabel) rsStatusLabel.textContent = `[${currentRsIndex + 1}/${rsQueue.length}] ${currentTrackingId}`;
        if (rsCounterLabel) rsCounterLabel.textContent = `${currentRsIndex + 1}/${rsQueue.length}`;
        if (rsProgressFill) rsProgressFill.style.width = `${((currentRsIndex + 1) / rsQueue.length) * 100}%`;

        dismissLingeringToasts();

        try {
          let createBtn = document.querySelector('button[data-cy="createRunsheetButton"], button[data-track-name="create_runsheet_click"]');
          if (createBtn && createBtn.offsetParent !== null) {
            createBtn.focus();
            createBtn.click();
            await new Promise(r => setTimeout(r, rsStepDelay + 100));
          }

          let agentInput = document.querySelector('div[data-cy="selectComponent-agentId"] input, input[id^="react-select-44"]');
          const waitFormStart = Date.now();
          while (!agentInput && Date.now() - waitFormStart < 2500) {
            agentInput = document.querySelector('div[data-cy="selectComponent-agentId"] input, input[id^="react-select-44"]');
            await new Promise(r => setTimeout(r, 80));
          }

          if (agentInput) {
            agentInput.focus();
            await injectValueIntoInput(agentInput, targetWishmaster);
            await new Promise(r => setTimeout(r, 150));
            const option = document.querySelector('div[class*="-option"], #agent-options div');
            if (option) option.click();
            await new Promise(r => setTimeout(r, 100));
          }

          const vehicleContainer = document.querySelector('div[data-cy="selectComponent-vehicleType"], div[data-testid="selectComponent-vehicleType"]');
          const vehicleInput = vehicleContainer ? vehicleContainer.querySelector('input') : document.querySelector('input[id^="react-select-45"]');
          if (vehicleContainer && vehicleInput) {
            vehicleInput.focus();
            vehicleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
            await injectValueIntoInput(vehicleInput, rsVehicleType);
            await new Promise(r => setTimeout(r, 120));

            const vehicleOptions = Array.from(document.querySelectorAll('#vehicle-options-menu div, div[class*="-option"]'));
            const targetOpt = vehicleOptions.find(opt => (opt.innerText || opt.textContent || '').trim().toUpperCase().includes(rsVehicleType.toUpperCase())) || vehicleOptions[0];
            if (targetOpt) {
              targetOpt.click();
              await new Promise(r => setTimeout(r, 100));
            }
          }

          const startScanBtn = document.querySelector('button[data-cy="buttonStartScanning"]');
          if (startScanBtn && startScanBtn.offsetParent !== null) {
            startScanBtn.focus();
            startScanBtn.click();
            await new Promise(r => setTimeout(r, 150));
          }

          let scanInput = document.querySelector('input#enteredShipmentId, input[data-testid="enterShipment"]');
          if (scanInput) {
            scanInput.removeAttribute('disabled');
            scanInput.disabled = false;
            await injectValueIntoInput(scanInput, currentTrackingId);
          }

          if (rsStatusLabel) rsStatusLabel.textContent = `Validating ${currentTrackingId}...`;
          let saveBtn = null;
          let realConflict = null;
          const checkStart = Date.now();

          while (Date.now() - checkStart < 2500) {
            const btn = getSaveButton(rsActionType);
            if (btn && !btn.disabled && (btn.classList.contains('primary') || btn.classList.contains('success'))) {
              saveBtn = btn;
              break;
            }

            const conflict = detectPreScanConflict(currentTrackingId);
            if (conflict) {
              realConflict = conflict;
              break;
            }

            await new Promise(r => setTimeout(r, 80));
          }

          if (realConflict || !saveBtn) {
            console.warn(`[ScanDeck] Skipped ${currentTrackingId}: ${realConflict || 'Validation failed'}`);
            if (rsStatusLabel) rsStatusLabel.textContent = `Skipped: ${currentTrackingId}`;
            skippedCount++;

            const discardBtn = document.querySelector('button[data-cy="discardRunsheet"]');
            if (discardBtn) discardBtn.click();
            await new Promise(r => setTimeout(r, rsStepDelay));
            continue;
          }

          if (rsStatusLabel) rsStatusLabel.textContent = `Saving ${currentTrackingId}...`;
          clickButtonOnce(saveBtn);
          successCount++;

          const redirectStart = Date.now();
          while (Date.now() - redirectStart < 4000) {
            const listCreateBtn = document.querySelector('button[data-cy="createRunsheetButton"]');
            if (!document.querySelector('button[data-cy="save"]') || (listCreateBtn && listCreateBtn.offsetParent !== null)) {
              break;
            }
            await new Promise(r => setTimeout(r, 120));
          }

          await new Promise(r => setTimeout(r, rsStepDelay + 100));

        } catch (err) {
          console.error(`Error on ${currentTrackingId}:`, err);
          skippedCount++;
          const discardBtn = document.querySelector('button[data-cy="discardRunsheet"]');
          if (discardBtn) discardBtn.click();
          await new Promise(r => setTimeout(r, rsStepDelay));
        }
      }

      isRsRunning = false;

      // Release sticky focus lock
      unlockThisTab();

      if (rsStartBtn) rsStartBtn.disabled = false; 
      if (rsBarcodeInput) rsBarcodeInput.disabled = false;
      if (rsPauseBtn) { rsPauseBtn.disabled = true; rsPauseBtn.textContent = '⏸'; }
      if (rsStopBtn) rsStopBtn.disabled = true;
      if (rsStatusLabel) rsStatusLabel.textContent = shouldRsStop ? "Runsheet: Stopped" : `Done! ✅ (${successCount} saved, ${skippedCount} skipped)`;
    }

    function checkScheduleTrigger() {
      rsScheduleEnabled = localStorage.getItem('rs_schedule_enabled') === 'true';

      if (!rsScheduleEnabled) {
        if (rsScheduleCountdown) rsScheduleCountdown.textContent = '--:--';
        if (rsScheduleEndCountdown) rsScheduleEndCountdown.textContent = '--:--';
        return;
      }

      const now = new Date();

      const end24H = get24Hour(rsEndHour, rsEndAmPm);
      const endM = parseInt(rsEndMin, 10) || 0;
      const targetEndDate = new Date();
      targetEndDate.setHours(end24H, endM, 0, 0);

      let diffEndMs = targetEndDate.getTime() - now.getTime();
      if (diffEndMs < -1000) {
        targetEndDate.setDate(targetEndDate.getDate() + 1);
        diffEndMs = targetEndDate.getTime() - now.getTime();
      }

      if (rsScheduleEndCountdown) {
        rsScheduleEndCountdown.textContent = formatDiff(diffEndMs);
      }

      if (isRsRunning) {
        if (now.getHours() === end24H && now.getMinutes() === endM) {
          shouldRsStop = true;
          if (rsStatusLabel) rsStatusLabel.textContent = '⏹ Scheduled End Time Reached! Stopping...';
          return;
        }
      }

      const start24H = get24Hour(rsStartHour, rsStartAmPm);
      const startM = parseInt(rsStartMin, 10) || 0;
      const targetStartDate = new Date();
      targetStartDate.setHours(start24H, startM, 0, 0);

      let diffStartMs = targetStartDate.getTime() - now.getTime();
      if (diffStartMs < -1000) {
        targetStartDate.setDate(targetStartDate.getDate() + 1);
        diffStartMs = targetStartDate.getTime() - now.getTime();
      }

      if (rsScheduleCountdown) {
        rsScheduleCountdown.textContent = formatDiff(diffStartMs);
      }

      // Pre-lock tab 2 seconds before trigger
      if (diffStartMs <= 2000 && diffStartMs > 1000) {
        lockThisTab();
      }

      // Auto-start runsheet
      if (diffStartMs <= 1000 && diffStartMs >= -2000) {
        if (!isRsRunning) {
          startRunsheetExecution();
        }
      }
    }

    if (rsScheduleTimer) clearInterval(rsScheduleTimer);
    rsScheduleTimer = setInterval(checkScheduleTrigger, 1000);

    rsScheduleToggle.onchange = () => {
      rsScheduleEnabled = rsScheduleToggle.checked;
      localStorage.setItem('rs_schedule_enabled', rsScheduleEnabled);
      rsScheduleConfig.style.display = rsScheduleEnabled ? 'flex' : 'none';
      if (rsScheduleEnabled) {
        rsScheduleCardWrapper.classList.add('active');
      } else {
        rsScheduleCardWrapper.classList.remove('active');
      }
      rsScheduleBadge.textContent = rsScheduleEnabled ? 'ACTIVE' : 'OFF';
      rsScheduleBadge.style.color = rsScheduleEnabled ? '#4338ca' : '#94a3b8';
      checkScheduleTrigger();
    };

    rsStartBtn.onclick = () => {
      startRunsheetExecution();
    };

    rsPauseBtn.onclick = () => {
      isRsPaused = !isRsPaused;
      rsPauseBtn.textContent = isRsPaused ? '▶' : '⏸';
      if (rsStatusLabel) rsStatusLabel.textContent = isRsPaused ? 'Runsheet: Paused' : 'Runsheet: Resumed';
    };

    rsStopBtn.onclick = () => {
      shouldRsStop = true;
      unlockThisTab();
      if (rsStatusLabel) rsStatusLabel.textContent = 'Runsheet: Stopping...';
    };
  }

  window.addEventListener('SCANDECK_PANEL_READY', (e) => {
    if (e.detail && e.detail.shadowRoot) {
      mount(e.detail.shadowRoot);
    }
  });

  const existingRoot = document.getElementById('barcode-injector-root');
  if (existingRoot && existingRoot.shadowRoot) {
    mount(existingRoot.shadowRoot);
  }

  return { mount };
})();