// =============================================================================
// KOT-ScanDeck: Licensed PRC Manual Scan Auditor & Global Profile Device ID
// Features:
//  - Single Global Device ID via chrome.storage.local (Works across ALL pages)
//  - Captures scans across ALL 3 tabs (Scanner, Runsheet, Auditor) when panel is open
//  - Exclusive 3-tab switcher (only the active tab's content is shown)
//  - Bound to /shipments/pendingreco + PRC DOM Elements (IS RTO / CPD)
// =============================================================================

window.KOT_AuditorModule = (function () {
  const SUPABASE_CONFIG = {
    url: 'https://pjlkrgqzghndndasdxik.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqbGtyZ3F6Z2huZG5kYXNkeGlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MTk5MzcsImV4cCI6MjA5ODI5NTkzN30.V0CDT9JQwXtVeMOxrbvD5TD4nEX30F_cM-EX6WqIzAI',
    pollIntervalMs: 10000,
    targetPath: '/shipments/pendingreco'
  };

  let DEVICE_ID = null;
  let isDeviceLicensed = false;
  let isAuditorCaptureEnabled = false;
  let deviceLabel = 'Unassigned PC';

  let auditorTargetSet = new Set();
  let auditorFoundSet = new Set();
  let globalRemoteAlarmActive = true;
  let localAlarmEnabled = true;
  let currentShadowRoot = null;
  let syncTimer = null;

  let bufferedInputTid = '';
  let lastLoggedTid = '';
  let lastLoggedTime = 0;

  window._kotIsDeviceLicensed = false;
  window._kotDeviceId = '';

  // ---------------------------------------------------------------------------
  // GLOBAL PROFILE DEVICE ID (Shared Across All Pages, Subdomains & Origins)
  // ---------------------------------------------------------------------------
  function resolveGlobalDeviceId() {
    return new Promise((resolve) => {
      const fallbackLocal = localStorage.getItem('kot_scandeck_device_id');

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(
          ['kot_scandeck_device_id', 'kot_device_approved_cache', 'kot_device_auditor_cache', 'kot_device_label_cache'],
          (res) => {
            let globalId = res.kot_scandeck_device_id;

            if (!globalId) {
              if (fallbackLocal) {
                globalId = fallbackLocal;
              } else {
                const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
                const timePart = Date.now().toString(36).slice(-4).toUpperCase();
                globalId = `KOT-${rand}-${timePart}`;
              }
              chrome.storage.local.set({ kot_scandeck_device_id: globalId });
            }

            localStorage.setItem('kot_scandeck_device_id', globalId);

            if (res.kot_device_approved_cache !== undefined) {
              isDeviceLicensed = res.kot_device_approved_cache === true || res.kot_device_approved_cache === 'true';
            }
            if (res.kot_device_auditor_cache !== undefined) {
              isAuditorCaptureEnabled = res.kot_device_auditor_cache === true || res.kot_device_auditor_cache === 'true';
            }
            if (res.kot_device_label_cache) {
              deviceLabel = res.kot_device_label_cache;
            }

            DEVICE_ID = globalId;
            window._kotDeviceId = globalId;
            window._kotIsDeviceLicensed = isDeviceLicensed;
            resolve(globalId);
          }
        );
      } else {
        let id = fallbackLocal;
        if (!id) {
          const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
          const timePart = Date.now().toString(36).slice(-4).toUpperCase();
          id = `KOT-${rand}-${timePart}`;
          localStorage.setItem('kot_scandeck_device_id', id);
        }
        DEVICE_ID = id;
        window._kotDeviceId = id;
        resolve(id);
      }
    });
  }

  function persistLicenseCache(approved, auditorOn, label) {
    isDeviceLicensed = approved;
    isAuditorCaptureEnabled = auditorOn;
    deviceLabel = label;
    window._kotIsDeviceLicensed = approved;

    localStorage.setItem('kot_device_approved_cache', String(approved));
    localStorage.setItem('kot_device_auditor_cache', String(auditorOn));
    localStorage.setItem('kot_device_label_cache', label);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        kot_scandeck_device_id: DEVICE_ID,
        kot_device_approved_cache: approved,
        kot_device_auditor_cache: auditorOn,
        kot_device_label_cache: label
      });
    }
  }

  // ---------------------------------------------------------------------------
  // GUARDS (Tab-Independent: Only checks if main popup panel is open)
  // ---------------------------------------------------------------------------
  function checkAuditorCaptureAllowed() {
    return isDeviceLicensed === true && isAuditorCaptureEnabled === true;
  }

  function isExtensionPanelVisible() {
    if (!currentShadowRoot) {
      const root = document.getElementById('barcode-injector-root');
      if (root && root.shadowRoot) currentShadowRoot = root.shadowRoot;
    }
    if (!currentShadowRoot) return false;
    const panel = currentShadowRoot.getElementById('panel');
    // Checks ONLY the outer popup panel — works whether Scanner, Runsheet, or Auditor tab is active
    return !!(panel && !panel.classList.contains('panel-hidden'));
  }

  function isPrcPendingRecoActive() {
    const currentUrl = window.location.href.toLowerCase();
    if (!currentUrl.includes(SUPABASE_CONFIG.targetPath)) return false;

    const elements = Array.from(document.querySelectorAll('.sc-AykKC, .fmcvyS, div, td, tr, span'));

    const hasRtoNode = elements.some((el) => {
      const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
      return text === 'IS RTO' || text === 'IS RTO:';
    });

    const hasCpdNode = elements.some((el) => {
      const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
      return text === 'CPD' || text === 'CPD:';
    });

    if (hasRtoNode || hasCpdNode) return true;

    const bodyText = (document.body.textContent || document.body.innerText || '')
      .replace(/\s+/g, ' ')
      .toUpperCase();

    return bodyText.includes('IS RTO YES') || bodyText.includes('IS RTO NO') || bodyText.includes('IS RTO:');
  }

  function detectIsRtoOnScreen() {
    const elements = Array.from(document.querySelectorAll('.sc-AykKC, .fmcvyS, div, td, tr, span'));

    const rtoLabelNode = elements.find((el) => {
      const text = el.textContent ? el.textContent.trim().toUpperCase() : '';
      return text === 'IS RTO' || text === 'IS RTO:';
    });

    if (rtoLabelNode) {
      const parentCell = rtoLabelNode.closest('.fmcvyS, div, td') || rtoLabelNode.parentElement;
      const containerText = parentCell ? parentCell.textContent.toUpperCase() : '';
      if (containerText.includes('YES') && !containerText.includes('IS RTO CV')) {
        return true;
      }
    } else {
      const bodyText = (document.body.textContent || document.body.innerText || '')
        .replace(/\s+/g, ' ')
        .toUpperCase();
      if (bodyText.includes('IS RTO YES')) {
        return true;
      }
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // 1. Verify Device License, Auditor Permission & Heartbeat
  // ---------------------------------------------------------------------------
  async function syncDeviceLicenseAndTargets() {
    try {
      if (!DEVICE_ID) {
        await resolveGlobalDeviceId();
      }

      const resDev = await fetch(
        `${SUPABASE_CONFIG.url}/rest/v1/extension_devices?device_id=eq.${encodeURIComponent(DEVICE_ID)}&select=device_id,is_approved,auditor_enabled,label`,
        {
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
          }
        }
      );

      if (resDev.ok) {
        const devRows = await resDev.json();
        const nowIso = new Date().toISOString();

        if (devRows.length === 0) {
          await fetch(`${SUPABASE_CONFIG.url}/rest/v1/extension_devices`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_CONFIG.anonKey,
              'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              device_id: DEVICE_ID,
              label: 'New Workstation',
              hostname: window.location.hostname || 'ERP-Browser',
              platform: navigator.platform || 'Unknown OS',
              user_agent: navigator.userAgent.slice(0, 100),
              is_approved: false,
              auditor_enabled: true,
              last_seen_at: nowIso
            })
          });
          persistLicenseCache(false, false, 'New Workstation');
        } else {
          const record = devRows[0];
          const approved = record.is_approved === true;
          const auditorOn = record.auditor_enabled !== false;
          const lbl = record.label || 'Workstation';

          persistLicenseCache(approved, auditorOn, lbl);

          await fetch(
            `${SUPABASE_CONFIG.url}/rest/v1/extension_devices?device_id=eq.${encodeURIComponent(DEVICE_ID)}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_CONFIG.anonKey,
                'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                last_seen_at: nowIso,
                hostname: window.location.hostname || 'ERP-Browser'
              })
            }
          );
        }
      }

      applyLicenseLockUi();

      if (!checkAuditorCaptureAllowed()) {
        auditorTargetSet.clear();
        updateAuditorUi();
        return;
      }

      const resTargets = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/auditor_targets?select=tracking_id`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });
      if (resTargets.ok) {
        const data = await resTargets.json();
        auditorTargetSet = new Set(data.map((item) => item.tracking_id.trim().toUpperCase()));
      }

      const resConfig = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/auditor_config?key=eq.global_alarm_enabled&select=value`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });
      if (resConfig.ok) {
        const configData = await resConfig.json();
        if (configData.length > 0) {
          globalRemoteAlarmActive = configData[0].value === 'true';
        }
      }

      updateAuditorUi();
    } catch (e) {
      console.warn('[License/Auditor] Sync error:', e);
    }
  }

  resolveGlobalDeviceId().then(() => {
    applyLicenseLockUi();
    syncDeviceLicenseAndTargets();
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(syncDeviceLicenseAndTargets, SUPABASE_CONFIG.pollIntervalMs);
  });

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.kot_scandeck_device_id) {
        DEVICE_ID = changes.kot_scandeck_device_id.newValue;
        window._kotDeviceId = DEVICE_ID;
      }
      if (changes.kot_device_approved_cache) {
        isDeviceLicensed = Boolean(changes.kot_device_approved_cache.newValue);
        window._kotIsDeviceLicensed = isDeviceLicensed;
        applyLicenseLockUi();
      }
      if (changes.kot_device_auditor_cache) {
        isAuditorCaptureEnabled = Boolean(changes.kot_device_auditor_cache.newValue);
        updateAuditorUi();
      }
      if (changes.kot_device_label_cache) {
        deviceLabel = changes.kot_device_label_cache.newValue || 'Workstation';
        updateAuditorUi();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Lock / Unlock Extension UI Panel Based on License Permission
  // ---------------------------------------------------------------------------
  function applyLicenseLockUi() {
    if (!currentShadowRoot) {
      const root = document.getElementById('barcode-injector-root');
      if (root && root.shadowRoot) currentShadowRoot = root.shadowRoot;
    }
    if (!currentShadowRoot) return;

    const panelBody = currentShadowRoot.getElementById('panel-body');
    if (!panelBody) return;

    let lockOverlay = currentShadowRoot.getElementById('kot-license-lock-overlay');

    if (!isDeviceLicensed) {
      if (!lockOverlay) {
        lockOverlay = document.createElement('div');
        lockOverlay.id = 'kot-license-lock-overlay';
        lockOverlay.style.cssText = `
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.96);
          color: #f8fafc;
          z-index: 9999;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 14px;
          gap: 8px;
        `;
        lockOverlay.innerHTML = `
          <div style="font-size:22px;">🔒</div>
          <div style="font-size:11px; font-weight:800; color:#f87171; letter-spacing:0.3px;">SYSTEM NOT AUTHORIZED</div>
          <div style="font-size:8.5px; color:#cbd5e1; line-height:1.4;">
            This workstation does not have permission to use KOT-ScanDeck.
          </div>
          <div id="kot-lock-device-id" style="background:#1e293b; border:1px solid #334155; padding:5px 8px; border-radius:5px; font-family:monospace; font-size:9.5px; color:#38bdf8; user-select:all;">
            ${DEVICE_ID || 'Loading ID...'}
          </div>
          <button id="kot-recheck-license-btn" style="margin-top:4px; background:#2563eb; color:#fff; border:none; padding:5px 10px; border-radius:5px; font-size:8.5px; font-weight:700; cursor:pointer;">
            🔄 Re-check License
          </button>
        `;
        panelBody.appendChild(lockOverlay);

        const recheckBtn = lockOverlay.querySelector('#kot-recheck-license-btn');
        if (recheckBtn) {
          recheckBtn.onclick = async () => {
            recheckBtn.textContent = '⏳ Checking...';
            await syncDeviceLicenseAndTargets();
            recheckBtn.textContent = '🔄 Re-check License';
          };
        }
      } else {
        const idBox = lockOverlay.querySelector('#kot-lock-device-id');
        if (idBox && DEVICE_ID) idBox.textContent = DEVICE_ID;
      }
    } else if (lockOverlay) {
      lockOverlay.remove();
    }
  }

  // ---------------------------------------------------------------------------
  // 3. High 3-Beep Piercing Alarm (Works Across All Tabs When Panel Open)
  // ---------------------------------------------------------------------------
  function playAuditorPiercingAlarm() {
    if (!checkAuditorCaptureAllowed()) return;
    if (!globalRemoteAlarmActive) return;
    if (!isExtensionPanelVisible()) return;
    if (!window.location.href.toLowerCase().includes(SUPABASE_CONFIG.targetPath)) return;

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.16, 0.32].forEach((startOffset) => {
        [2400, 1600].forEach((freq) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'square';
          const t = ctx.currentTime + startOffset;
          osc.frequency.setValueAtTime(freq, t);
          gain.gain.setValueAtTime(0.35, t);
          gain.gain.setValueAtTime(0.35, t + 0.10);
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.12);
        });
      });
    } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // 4. Log Scanned Shipments to Supabase
  // ---------------------------------------------------------------------------
  async function logManualScanToCloud(tid, isMissing, isRto, scanTimestamp) {
    if (!checkAuditorCaptureAllowed()) return;
    if (!isExtensionPanelVisible()) return;
    if (!window.location.href.toLowerCase().includes(SUPABASE_CONFIG.targetPath)) return;

    const now = Date.now();
    if (tid === lastLoggedTid && now - lastLoggedTime < 1500) return;
    lastLoggedTid = tid;
    lastLoggedTime = now;

    const stationTag = `${deviceLabel} (${DEVICE_ID})`;

    fetch(`${SUPABASE_CONFIG.url}/rest/v1/manual_scans`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_CONFIG.anonKey,
        'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({
        tracking_id: tid,
        scanned_at: scanTimestamp,
        is_missing_match: isMissing,
        is_rto: isRto,
        device_info: stationTag
      })
    }).catch(() => {});

    if (isMissing) {
      fetch(`${SUPABASE_CONFIG.url}/rest/v1/auditor_found_logs`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tracking_id: tid,
          found_at: scanTimestamp,
          notes: `${stationTag} | RTO: ${isRto ? 'YES' : 'NO'}`
        })
      }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Universal Hardware Scanner Interceptor (Works on ALL 3 Tabs)
  // ---------------------------------------------------------------------------
  function getErpShipmentInput() {
    return (
      document.querySelector('input#enteredShipmentId') ||
      document.querySelector('input[data-testid="enterShipment"]') ||
      Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).find(
        (el) => !el.closest('#barcode-injector-root') && el.offsetParent !== null
      )
    );
  }

  function processCapturedScan(rawTid) {
    const cleanTid = (rawTid || '').trim().toUpperCase();
    if (cleanTid.length < 6) return;
    if (!checkAuditorCaptureAllowed()) return;
    if (!isExtensionPanelVisible()) return;
    if (!window.location.href.toLowerCase().includes(SUPABASE_CONFIG.targetPath)) return;

    const exactScanTime = new Date().toISOString();

    setTimeout(() => {
      if (!checkAuditorCaptureAllowed()) return;
      if (!isExtensionPanelVisible()) return;
      if (!isPrcPendingRecoActive()) return;

      const isMissing = auditorTargetSet.has(cleanTid);
      const isRto = detectIsRtoOnScreen();

      logManualScanToCloud(cleanTid, isMissing, isRto, exactScanTime);

      if (isMissing) {
        auditorFoundSet.add(cleanTid);
        if (localAlarmEnabled) {
          playAuditorPiercingAlarm();
        }
        updateAuditorUi();
      }
    }, 350);
  }

  function setupManualScanInterceptor() {
    // Buffer value continuously on input/change events from the host page
    ['input', 'change'].forEach((evtName) => {
      document.addEventListener(evtName, (e) => {
        if (!checkAuditorCaptureAllowed()) return;
        if (window._kotIsAutomatedScanningActive) return;
        const target = e.target;
        if (!target || target.id === 'barcode-injector-root' || target.closest('#barcode-injector-root')) return;

        if (target.tagName === 'INPUT') {
          const val = (target.value || '').trim().toUpperCase();
          if (val.length >= 6) {
            bufferedInputTid = val;
          }
        }
      }, true);
    });

    // Capture Enter key regardless of whether Scanner, Runsheet, or Auditor tab is open
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (!checkAuditorCaptureAllowed()) return;
      if (!isExtensionPanelVisible()) return;
      if (!window.location.href.toLowerCase().includes(SUPABASE_CONFIG.targetPath)) return;
      if (window._kotIsAutomatedScanningActive) return;

      let candidateVal = '';
      const activeEl = document.activeElement;

      if (activeEl && activeEl.tagName === 'INPUT' && activeEl.id !== 'barcode-injector-root') {
        candidateVal = activeEl.value || '';
      }

      if (!candidateVal.trim()) {
        const erpInput = getErpShipmentInput();
        if (erpInput && erpInput.value) {
          candidateVal = erpInput.value;
        }
      }

      if (!candidateVal.trim() && bufferedInputTid) {
        candidateVal = bufferedInputTid;
      }

      bufferedInputTid = '';
      if (candidateVal.trim().length >= 6) {
        processCapturedScan(candidateVal);
      }
    }, true);
  }

  setupManualScanInterceptor();

  // ---------------------------------------------------------------------------
  // 6. DOM Mutation Observer (Runs Across All 3 Tabs)
  // ---------------------------------------------------------------------------
  function inspectPageForAuditedTids() {
    if (!checkAuditorCaptureAllowed()) return;
    if (!isExtensionPanelVisible() || !isPrcPendingRecoActive()) return;
    if (auditorTargetSet.size === 0) return;

    const pageText = (document.body.innerText || document.body.textContent || '').toUpperCase();

    for (const tid of auditorTargetSet) {
      if (pageText.includes(tid) && !auditorFoundSet.has(tid)) {
        auditorFoundSet.add(tid);
        const isRto = detectIsRtoOnScreen();
        const exactScanTime = new Date().toISOString();
        if (localAlarmEnabled) {
          playAuditorPiercingAlarm();
        }
        logManualScanToCloud(tid, true, isRto, exactScanTime);
        updateAuditorUi();
      }
    }
  }

  const observer = new MutationObserver(() => inspectPageForAuditedTids());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // ---------------------------------------------------------------------------
  // 7. Mount into ScanDeck UI Tab (Exclusive 3-Tab Switcher)
  // ---------------------------------------------------------------------------
  function mount(shadowRoot) {
    if (!shadowRoot || shadowRoot.getElementById('tab-btn-auditor')) return;
    currentShadowRoot = shadowRoot;

    const tabBar = shadowRoot.querySelector('.tab-bar');
    const panelBody = shadowRoot.querySelector('#panel-body');
    if (!tabBar || !panelBody) return;

    const auditorBtn = document.createElement('button');
    auditorBtn.id = 'tab-btn-auditor';
    auditorBtn.className = 'tab-btn';
    auditorBtn.innerHTML = '🔍 Auditor';
    tabBar.appendChild(auditorBtn);

    const auditorContent = document.createElement('div');
    auditorContent.id = 'tab-content-auditor';
    auditorContent.className = 'tab-content hidden-tab';
    auditorContent.innerHTML = `
      <div style="background:#ecfeff; border:1px solid #a5f3fc; border-radius:6px; padding:6px; display:flex; flex-direction:column; gap:3px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:8.5px; font-weight:700; color:#0891b2;">🎯 PendingReco Auditor</span>
          <div style="display:flex; align-items:center; gap:4px;">
            <span id="auditor-capture-badge" style="font-size:7px; font-weight:800; padding:1px 3px; border-radius:3px; background:${isAuditorCaptureEnabled ? '#dcfce7' : '#fef3c7'}; color:${isAuditorCaptureEnabled ? '#15803d' : '#b45309'};">
              CAPTURE: ${isAuditorCaptureEnabled ? 'ON' : 'PAUSED'}
            </span>
            <label style="cursor:pointer; display:flex; align-items:center; gap:2px; font-size:7.5px; font-weight:700; color:#0e7490;">
              <input type="checkbox" id="auditor-alarm-chk" ${localAlarmEnabled ? 'checked' : ''} /> ALARM
            </label>
          </div>
        </div>
        <div id="auditor-device-info" style="font-size:7.5px; color:#0e7490; font-family:monospace;">
          ID: <b>${DEVICE_ID || '...'}</b> (${deviceLabel})
        </div>
      </div>

      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
          <label style="font-size:8px; font-weight:700; color:#64748b;">Missing Target Queue</label>
          <span id="auditor-counter" style="font-size:8px; font-weight:700; color:#0891b2;">${auditorFoundSet.size}/${auditorTargetSet.size} Detected</span>
        </div>
        <textarea id="auditor-input" readonly style="height:42px; font-size:9px; width:100%; border:1px solid #cbd5e1; border-radius:5px; padding:4px; font-family:monospace; background:#f8fafc;">${Array.from(auditorTargetSet).join('\n')}</textarea>
      </div>

      <div style="display:flex; gap:4px;">
        <button id="auditor-refresh-btn" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1.2; font-weight:700; background:#e0f2fe; color:#0369a1; border-color:#bae6fd;">🔄 Sync License & TIDs</button>
        <button id="auditor-test-sound" class="btn btn-secondary" style="padding:4px; font-size:8px; flex:1;">🔊 Test Alarm</button>
      </div>

      <div style="display:flex; flex-direction:column; gap:2px;">
        <label style="font-size:7.5px; font-weight:700; color:#059669;">Found Shipments (PendingReco Synced):</label>
        <div id="auditor-found-list" style="max-height:55px; overflow-y:auto; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:4px; padding:4px; font-size:8px; font-family:monospace; color:#15803d;">
          ${renderFoundList()}
        </div>
      </div>
    `;
    panelBody.appendChild(auditorContent);

    // Exclusive 3-Tab Switcher: Shows ONLY the clicked tab and hides the other 2
    function activateExclusiveTab(btnId) {
      const targetContentId = btnId.replace('tab-btn-', 'tab-content-');

      shadowRoot.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.classList.remove('active', 'rs-active');
      });

      shadowRoot.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.add('hidden-tab');
        content.style.display = 'none';
      });

      const activeBtn = shadowRoot.getElementById(btnId);
      const activeContent = shadowRoot.getElementById(targetContentId);

      if (activeBtn) {
        activeBtn.classList.add('active');
        if (btnId === 'tab-btn-runsheet') activeBtn.classList.add('rs-active');
      }
      if (activeContent) {
        activeContent.classList.remove('hidden-tab');
        activeContent.style.display = 'flex';
      }
    }

    // Intercept clicks on ANY of the 3 tab buttons so they switch exclusively
    if (!tabBar.dataset.exclusiveTabsBound) {
      tabBar.dataset.exclusiveTabsBound = 'true';
      tabBar.addEventListener('click', (e) => {
        const clickedBtn = e.target.closest('.tab-btn');
        if (clickedBtn && clickedBtn.id) {
          e.stopImmediatePropagation();
          activateExclusiveTab(clickedBtn.id);
        }
      }, true);
    }

    // Ensure initial active tab is cleanly synced on mount
    const initialActive = tabBar.querySelector('.tab-btn.active') || shadowRoot.getElementById('tab-btn-scanner');
    if (initialActive && initialActive.id) {
      activateExclusiveTab(initialActive.id);
    }

    const chk = shadowRoot.getElementById('auditor-alarm-chk');
    const testBtn = shadowRoot.getElementById('auditor-test-sound');
    const refreshBtn = shadowRoot.getElementById('auditor-refresh-btn');

    chk.addEventListener('change', () => { localAlarmEnabled = chk.checked; });
    testBtn.addEventListener('click', () => playAuditorPiercingAlarm());
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.textContent = '⏳ Syncing...';
      await syncDeviceLicenseAndTargets();
      refreshBtn.textContent = '✅ Synced!';
      setTimeout(() => { refreshBtn.textContent = '🔄 Sync License & TIDs'; }, 1500);
    });

    applyLicenseLockUi();
    updateAuditorUi();
  }

  function renderFoundList() {
    if (!isAuditorCaptureEnabled) return '<span style="color:#b45309;">Auditor scan capture disabled for this PC by Admin</span>';
    if (auditorFoundSet.size === 0) return '<span style="color:#94a3b8;">No missing scans recorded</span>';
    return Array.from(auditorFoundSet).map((id) => `✅ Found: ${id}`).join('<br>');
  }

  function updateAuditorUi() {
    if (!currentShadowRoot) {
      const root = document.getElementById('barcode-injector-root');
      if (root && root.shadowRoot) currentShadowRoot = root.shadowRoot;
    }
    if (!currentShadowRoot) return;

    const counter = currentShadowRoot.getElementById('auditor-counter');
    const input = currentShadowRoot.getElementById('auditor-input');
    const foundList = currentShadowRoot.getElementById('auditor-found-list');
    const captureBadge = currentShadowRoot.getElementById('auditor-capture-badge');
    const deviceInfoEl = currentShadowRoot.getElementById('auditor-device-info');

    if (counter) counter.textContent = `${auditorFoundSet.size}/${auditorTargetSet.size} Detected`;
    if (input && document.activeElement !== input) input.value = Array.from(auditorTargetSet).join('\n');
    if (foundList) foundList.innerHTML = renderFoundList();
    if (deviceInfoEl) deviceInfoEl.innerHTML = `ID: <b>${DEVICE_ID || '...'}</b> (${deviceLabel})`;
    if (captureBadge) {
      captureBadge.style.background = isAuditorCaptureEnabled ? '#dcfce7' : '#fef3c7';
      captureBadge.style.color = isAuditorCaptureEnabled ? '#15803d' : '#b45309';
      captureBadge.textContent = `CAPTURE: ${isAuditorCaptureEnabled ? 'ON' : 'PAUSED'}`;
    }
  }

  const root = document.getElementById('barcode-injector-root');
  if (root && root.shadowRoot) mount(root.shadowRoot);

  window.addEventListener('SCANDECK_PANEL_READY', (e) => {
    if (e.detail && e.detail.shadowRoot) mount(e.detail.shadowRoot);
  });

  return { mount, syncDeviceLicenseAndTargets };
})();
