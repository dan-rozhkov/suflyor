/// <reference path="./chrome.d.ts" />
// Toolbar click: open the side panel first (needs the user gesture), then remember the tab.
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId })
  if (tab.id !== undefined) {
    void chrome.storage.session.set({ targetTab: { tabId: tab.id, title: tab.title ?? '' } })
  }
})
