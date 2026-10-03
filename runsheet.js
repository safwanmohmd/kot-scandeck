// =============================================================================
// KOT-ScanDeck: Standalone Auto-Runsheet Engine (v6.0 - Scheduled Creation Support)
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
  let rsScheduleTime = localStorage.getItem('rs_schedule_time') || '';
  let rsScheduleTimer = null;

  const tabStyles = `
    .tab-btn.rs-active {
      background: #4338ca !important;
      color: #ffffff !important;
      box-shadow: 0 1px 3px rgba(67, 56, 202, 0.3) !important;
    }
    .rs-card {
      background: #f5f3ff !important;
      border: 1px solid #c4b5fd !important;
      border-radius: 7px;
      padding: 7px;
      display: flex;
      flex-direction: column;
      gap: 5px;
      box-shadow: 0 1px 3px rgba(109, 40, 217, 0.05);
    }
    .rs-card label {
      color: #4338ca !important;
      font-weight: 700;
      font-size: 8px;
      letter-spacing: 0.2px;
    }
    .rs-select, 
    #rs-agent-input, 
    #rs-vehicle-select, 
    #rs-action-select, 
    #rs-delay-input,
    #rs-schedule-time-input {
      background-color: #ffffff !important;
      color: #0f172a !important;
      border: 1px solid #c4b5fd !important;
      border-radius: 4px;
      padding: 3px 6px;
      font-size: 9px;
      font-weight: 600;
      outline: none;
      width: 100%;
      caret-color: #4338ca !important;
    }
    .rs-select:focus,
    #rs-agent-input:focus,
    #rs-vehicle-select:focus,
    #rs-action-select:focus,
    #rs-delay-input:focus,
    #rs-schedule-time-input:focus {
      border-color: #6366f1 !important;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2) !important;
      background-color: #ffffff !important;
      color: #0f172a !important;
    }
    #rs-barcode-input {
      background-color: #faf5ff !important;
      color: #0f172a !important;
      border: 1px solid #c4b5fd !important;
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
    }
    #rs-barcode-input:focus {
      background-color: #ffffff !important;
      border-color: #6366f1 !important;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25) !important;
      color: #0f172a !important;
    }
    #rs-barcode-input::placeholder {
      color: #a5b4fc !important;
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
      background: #faf5ff !important;
      border: 1px solid #ede9fe !important;
    }
    .rs-schedule-card {
      background: #ffffff;
      border: 1px dashed #c4b5fd;
      border-radius: 5px;
      padding: 4px 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .rs-schedule-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .rs-schedule-header label {
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      margin: 0;
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

        <div class="rs-schedule-card">
          <div class="rs-schedule-header">
            <label for="rs-schedule-toggle">
              <input type="checkbox" id="rs-schedule-toggle" ${rsScheduleEnabled ? 'checked' : ''} style="cursor:pointer;" />
              <span>⏰ Auto-Schedule Runsheet</span>
            </label>
            <span id="rs-schedule-badge" style="font-size:7.5px; font-weight:700; color:${rsScheduleEnabled ? '#4338ca' : '#94a3b8'};">
              ${rsScheduleEnabled ? 'ACTIVE' : 'OFF'}
            </span>
          </div>
          <div id="rs-schedule-config" style="display:${rsScheduleEnabled ? 'flex' : 'none'}; align-items:center; gap:5px;">
            <input type="time" id="rs-schedule-time-input" class="rs-select" value="${rsScheduleTime}" style="padding:2px 4px; font-size:9px;" />
            <span id="rs-schedule-countdown" style="font-size:8px; font-weight:700; color:#6366f1; white-space:nowrap;">--:--</span>
          </div>
        </div>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
          <label style="color:#4338ca;">Bulk Tracking IDs (1 Per Runsheet)</label>
          <span id="rs-queue-counter" style="font-size:8px; font-weight:700; color:#6366f1;">0 detected</span>
        </div>
        <textarea id="rs-barcode-input" placeholder="Paste tracking IDs (1 per line or space separated)..."></textarea>
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

  // Pre-save error detection only (Ignores transient saving warnings)
  function detectPreScanConflict(currentId) {
    const errorContainers = Array.from(document.querySelectorAll('div[data-cy="non-acionable-toast"], div[data-cy="toastMessage"], div[role="alert"], .Toastify__toast-body'));
    const conflictKeywords = ['ALREADY', 'ACTIVE RUNSHEET', 'NOT PRESENT IN DATABASE', 'DOES NOT EXIST', 'INVALID SHIPMENT'];

    for (const el of errorContainers) {
      if (el.closest('#barcode-injector-root')) continue;
      const txt = (el.innerText || el.textContent || '').trim().toUpperCase();
      if (!txt) continue;

      // Ignore generic post-save network glitches
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

  // Single, reliable click dispatch
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
    const rsScheduleToggle = shadowRoot.getElementById('rs-schedule-toggle');
    const rsScheduleConfig = shadowRoot.getElementById('rs-schedule-config');
    const rsScheduleTimeInput = shadowRoot.getElementById('rs-schedule-time-input');
    const rsScheduleBadge = shadowRoot.getElementById('rs-schedule-badge');
    const rsScheduleCountdown = shadowRoot.getElementById('rs-schedule-countdown');

    function parseQueue() {
      const raw = rsBarcodeInput.value || '';
      rsQueue = raw.split(/[\n,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      rsQueueCounter.textContent = `${rsQueue.length} detected`;
      rsCounterLabel.textContent = `0/${rsQueue.length}`;
    }

    rsBarcodeInput.oninput = parseQueue;
    rsAgentInput.onchange = () => { rsTargetAgent = rsAgentInput.value.trim(); localStorage.setItem('rs_target_agent', rsTargetAgent); };
    rsVehicleSelect.onchange = () => { rsVehicleType = rsVehicleSelect.value; localStorage.setItem('rs_vehicle_type', rsVehicleType); };
    rsActionSelect.onchange = () => { rsActionType = rsActionSelect.value; localStorage.setItem('rs_action_type', rsActionType); };
    rsDelayInput.onchange = () => { rsStepDelay = parseInt(rsDelayInput.value, 10) || 500; localStorage.setItem('rs_step_delay', rsStepDelay); };

    // =========================================================================
    // Schedule Engine Watcher
    // =========================================================================
    function checkScheduleTrigger() {
      if (!rsScheduleEnabled || !rsScheduleTime) {
        if (rsScheduleCountdown) rsScheduleCountdown.textContent = '--:--';
        return;
      }

      const now = new Date();
      const [schedH, schedM] = rsScheduleTime.split(':').map(n => parseInt(n, 10));
      if (isNaN(schedH) || isNaN(schedM)) return;

      const targetDate = new Date();
      targetDate.setHours(schedH, schedM, 0, 0);

      let diffMs = targetDate.getTime() - now.getTime();
      if (diffMs < -1000) {
        targetDate.setDate(targetDate.getDate() + 1);
        diffMs = targetDate.getTime() - now.getTime();
      }

      if (diffMs <= 1000 && diffMs >= -2000) {
        if (!isRsRunning) {
          rsScheduleEnabled = false;
          rsScheduleToggle.checked = false;
          rsScheduleConfig.style.display = 'none';
          rsScheduleBadge.textContent = 'TRIGGERED';
          rsScheduleBadge.style.color = '#059669';
          localStorage.setItem('rs_schedule_enabled', 'false');
          rsStatusLabel.textContent = '⏰ Schedule Reached! Auto-Starting...';
          rsStartBtn.click();
          return;
        }
      }

      const totalSec = Math.max(0, Math.floor(diffMs / 1000));
      const hours = Math.floor(totalSec / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      if (rsScheduleCountdown) {
        rsScheduleCountdown.textContent = hours > 0
          ? `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
          : `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }
    }

    if (rsScheduleTimer) clearInterval(rsScheduleTimer);
    rsScheduleTimer = setInterval(checkScheduleTrigger, 1000);

    rsScheduleToggle.onchange = () => {
      rsScheduleEnabled = rsScheduleToggle.checked;
      localStorage.setItem('rs_schedule_enabled', rsScheduleEnabled);
      rsScheduleConfig.style.display = rsScheduleEnabled ? 'flex' : 'none';
      rsScheduleBadge.textContent = rsScheduleEnabled ? 'ACTIVE' : 'OFF';
      rsScheduleBadge.style.color = rsScheduleEnabled ? '#4338ca' : '#94a3b8';
      checkScheduleTrigger();
    };

    rsScheduleTimeInput.onchange = () => {
      rsScheduleTime = rsScheduleTimeInput.value;
      localStorage.setItem('rs_schedule_time', rsScheduleTime);
      checkScheduleTrigger();
    };

    // =========================================================================
    // Core Execution Loop: 1 TID = 1 Runsheet (Resilient to Post-Save Errors)
    // =========================================================================
    rsStartBtn.onclick = async () => {
      parseQueue();
      if (rsQueue.length === 0) { alert("⚠️ Paste at least one Tracking ID!"); return; }
      const targetWishmaster = rsAgentInput.value.trim();
      if (!targetWishmaster) { alert("⚠️ Please provide a Wishmaster Name!"); return; }

      isRsRunning = true; isRsPaused = false; shouldRsStop = false;
      rsStartBtn.disabled = true; rsBarcodeInput.disabled = true;
      rsPauseBtn.disabled = false; rsStopBtn.disabled = false;

      let skippedCount = 0, successCount = 0;

      for (currentRsIndex = 0; currentRsIndex < rsQueue.length; currentRsIndex++) {
        if (shouldRsStop) break;

        while (isRsPaused) {
          rsStatusLabel.textContent = "Runsheet: Paused";
          await new Promise(res => setTimeout(res, 200));
          if (shouldRsStop) break;
        }
        if (shouldRsStop) break;

        const currentTrackingId = rsQueue[currentRsIndex];
        rsStatusLabel.textContent = `[${currentRsIndex + 1}/${rsQueue.length}] ${currentTrackingId}`;
        rsCounterLabel.textContent = `${currentRsIndex + 1}/${rsQueue.length}`;
        rsProgressFill.style.width = `${((currentRsIndex + 1) / rsQueue.length) * 100}%`;

        dismissLingeringToasts();

        try {
          // STEP 1: Open "Create Runsheet" from list if needed
          let createBtn = document.querySelector('button[data-cy="createRunsheetButton"], button[data-track-name="create_runsheet_click"]');
          if (createBtn && createBtn.offsetParent !== null) {
            createBtn.focus();
            createBtn.click();
            await new Promise(r => setTimeout(r, rsStepDelay + 100));
          }

          // Wait until form inputs mount
          let agentInput = document.querySelector('div[data-cy="selectComponent-agentId"] input, input[id^="react-select-44"]');
          const waitFormStart = Date.now();
          while (!agentInput && Date.now() - waitFormStart < 2500) {
            agentInput = document.querySelector('div[data-cy="selectComponent-agentId"] input, input[id^="react-select-44"]');
            await new Promise(r => setTimeout(r, 80));
          }

          // STEP 2: Assign Wishmaster
          if (agentInput) {
            agentInput.focus();
            await injectValueIntoInput(agentInput, targetWishmaster);
            await new Promise(r => setTimeout(r, 150));
            const option = document.querySelector('div[class*="-option"], #agent-options div');
            if (option) option.click();
            await new Promise(r => setTimeout(r, 100));
          }

          // STEP 3: Assign Vehicle Type (Bike)
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

          // STEP 4: Unlock Scan Input
          const startScanBtn = document.querySelector('button[data-cy="buttonStartScanning"]');
          if (startScanBtn && startScanBtn.offsetParent !== null) {
            startScanBtn.focus();
            startScanBtn.click();
            await new Promise(r => setTimeout(r, 150));
          }

          // STEP 5: Inject Tracking ID
          let scanInput = document.querySelector('input#enteredShipmentId, input[data-testid="enterShipment"]');
          if (scanInput) {
            scanInput.removeAttribute('disabled');
            scanInput.disabled = false;
            await injectValueIntoInput(scanInput, currentTrackingId);
          }

          // STEP 6: Fast Pre-Save Validation (Save vs Conflict)
          rsStatusLabel.textContent = `Validating ${currentTrackingId}...`;
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

          // Handle true conflict (shipment not in db, active runsheet, etc.)
          if (realConflict || !saveBtn) {
            console.warn(`[ScanDeck] Skipped ${currentTrackingId}: ${realConflict || 'Validation failed'}`);
            rsStatusLabel.textContent = `Skipped: ${currentTrackingId}`;
            skippedCount++;

            const discardBtn = document.querySelector('button[data-cy="discardRunsheet"]');
            if (discardBtn) discardBtn.click();
            await new Promise(r => setTimeout(r, rsStepDelay));
            continue;
          }

          // STEP 7: Save Draft (Once, cleanly)
          rsStatusLabel.textContent = `Saving ${currentTrackingId}...`;
          clickButtonOnce(saveBtn);
          
          // Even if Ekart displays a transient saving warning, the draft count increments on backend
          successCount++;

          // STEP 8: Wait for Navigation/Redirect to Settle
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
      rsStartBtn.disabled = false; rsBarcodeInput.disabled = false;
      rsPauseBtn.disabled = true; rsPauseBtn.textContent = '⏸';
      rsStopBtn.disabled = true;
      rsStatusLabel.textContent = shouldRsStop ? "Runsheet: Stopped" : `Done! ✅ (${successCount} saved, ${skippedCount} skipped)`;
    };

    rsPauseBtn.onclick = () => {
      isRsPaused = !isRsPaused;
      rsPauseBtn.textContent = isRsPaused ? '▶' : '⏸';
      rsStatusLabel.textContent = isRsPaused ? 'Runsheet: Paused' : 'Runsheet: Resumed';
    };

    rsStopBtn.onclick = () => {
      shouldRsStop = true;
      rsStatusLabel.textContent = 'Runsheet: Stopping...';
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