# Issues with SC Terra
* Password auto-fill does not work
* For some pages it does not save sign-in cookies so you have to resign-in every time the browser is relaunched.
* DevTools (CTRL-SHIFT-I) are corrupted, when opened it opens a sidebar and a popup window, and the sidebar cannot be closed. Viewport in devtools does not work.
* Dark mode flag sometimes makes pages that are already dark into a cursed light mode
* The AI chat should have web search
* Favicons sometimes do not oad
* On the chrome webstore a popup appears asking you to switch to chrome, simply replacing every instance of "chrome" on the webstore does not work.
* Sidebar api for chrome extensions does not work
* Tab groups should have capabilities to be closed, and reopened maintaining its contents

## Status in 0.4.5

All of the above were worked on in 0.4.5. What changed, and what still needs trying by hand:

* Password auto-fill: a list of saved logins now appears under sign-in fields, and a site with one saved login fills by itself. Try it on a real site you use.
* Sign-in cookies: sign-ins meant to last only until closing are now kept (Settings > Privacy > Stay signed in after closing). Sign in to the site that forgot you, restart, and check.
* DevTools: open beside the page with no popup window, close from the X on their bar, and the device toolbar works. Try Ctrl Shift I, then Ctrl Shift M inside DevTools.
* Dark mode flag: pages that are already dark are recognised better, and stay dark. Tell me any site that still turns light.
* AI chat web search: the Web button in the assistant searches DuckDuckGo and cites the results.
* Favicons: now fetched by the browser itself through the tab's own session, with /favicon.ico as a fallback.
* Chrome Web Store "switch to Chrome": the store is now told the browser is Google Chrome in its client hints. Needs checking on the live store.
* Extension side panels: calls an extension makes while starting are no longer lost. Needs checking with Sider.
* Tab groups: Close group keeps the group, to reopen from the tab menu, the archive page or the command palette. Delete group closes it for good.
