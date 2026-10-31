chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'try', title: 'Try the extension', contexts: ['page'] })
})

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message === 'open-tab') chrome.tabs.create({ url: 'data:text/html,<title>Opened by extension</title>' })
  if (message === 'tabs') chrome.tabs.query({}).then((tabs) => reply(tabs.length))
  return true
})
