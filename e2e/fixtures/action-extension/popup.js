chrome.runtime.sendMessage('tabs').then((count) => {
  document.title = `Tabs: ${count}`
})
