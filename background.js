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

// 3. Keep-alive message handler from runsheet.js
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

  return true;
});