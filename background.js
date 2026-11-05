let lockedTabId = null;
let isRunsheetActive = false;
let isSwitching = false;

// 1. Force focus strictly to the target tab without opening new windows/tabs
function pullFocusBack() {
  if (!isRunsheetActive || !lockedTabId || isSwitching) return;

  isSwitching = true;
  setTimeout(() => {
    chrome.tabs.get(lockedTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        isRunsheetActive = false;
        lockedTabId = null;
        isSwitching = false;
        return;
      }

      // Switch straight back to the existing tab inside the same window
      chrome.tabs.update(lockedTabId, { active: true, highlighted: true }, () => {
        if (chrome.runtime.lastError) { /* ignore */ }
        isSwitching = false;
      });
    });
  }, 15);
}

// 2. Intercept ANY user attempt to switch to another tab in the same window
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (isRunsheetActive && lockedTabId) {
    if (activeInfo.tabId !== lockedTabId) {
      pullFocusBack();
    }
  }
});

// 3. Keep-alive message handler from runsheet.js & Auditor internal sync
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'LOCK_RUNSHEET_TAB' && sender.tab) {
    isRunsheetActive = true;
    lockedTabId = sender.tab.id;
    pullFocusBack();
    sendResponse({ status: 'locked', tabId: lockedTabId });
  }

  if (message.action === 'UNLOCK_RUNSHEET_TAB') {
    isRunsheetActive = false;
    lockedTabId = null;
    isSwitching = false;
    sendResponse({ status: 'unlocked' });
  }

  if (message.action === 'KEEP_ALIVE_PULSE' && sender.tab) {
    isRunsheetActive = true;
    lockedTabId = sender.tab.id;
    sendResponse({ status: 'alive' });
  }

  // Auditor query: Allows auditor.js to request the latest active TIDs whenever any tab loads
  if (message.action === 'GET_PERSISTED_AUDITOR_TIDS') {
    chrome.storage.local.get(['auditor_target_tids', 'auditor_alarm_enabled'], (data) => {
      sendResponse({
        tids: data.auditor_target_tids || [],
        enabled: typeof data.auditor_alarm_enabled !== 'undefined' ? data.auditor_alarm_enabled : true
      });
    });
    return true;
  }

  return true;
});

// 4. External Web Page Bridge: Receives TIDs from the React Sender page
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message && message.type === 'SET_AUDITOR_TARGET_TIDS') {
    const rawList = message.tids || [];
    const cleanList = Array.from(
      new Set(
        (Array.isArray(rawList) ? rawList : String(rawList).split(/[\n,;\s]+/))
          .map((s) => String(s).trim().toUpperCase())
          .filter(Boolean)
      )
    );

    // 1. Commit permanently to chrome.storage.local
    chrome.storage.local.set({ auditor_target_tids: cleanList }, () => {
      console.log(`[ScanDeck Background] Persisted ${cleanList.length} Auditor TIDs.`);
    });

    // 2. Broadcast immediately to all open tabs running content.js / auditor.js
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'SYNC_AUDITOR_TIDS',
          tids: cleanList
        }).catch(() => {
          // Tab does not contain content script; safe to ignore
        });
      });
    });

    sendResponse({ status: 'success', count: cleanList.length });
  }
  return true;
});