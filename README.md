# Steam Badge Assistant

Allows you to buy all Steam trading cards for a badge with a click or two.

A UserScript based on [Steam Trading Card Bulk Buyer by Dr. McKay](https://bitbucket.org/Doctor_McKay/steam-trading-card-bulk-buyer) and inspired by [this script by xPaw](https://gist.github.com/xPaw/73f8ae2031b4e528abf7).

#### Improvements inclue:
- Asynchronous requests to load more faster
- Improved error handling (in my opinion at least)
- Uses Steam's built-in modals to display the current status
- Instantly crafts the badge, no reload required

#### Installation:
- Chrome: [Tampermonkey](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo?hl=en)
- Firefox: [Greasemonkey](https://addons.mozilla.org/en-US/firefox/addon/greasemonkey/)

## [![Install](https://i.imgur.com/LflUAni.png)](https://github.com/notderw/Steam-Badge-Assistant/raw/master/steam-badge-assistant.user.js)

#### Screenshots:
![](https://i.imgur.com/hPmcyUm.png)
![](https://i.imgur.com/lezvsyk.png)

#### Known Issues:
Some cards have special characters in them that cause API calls to fail, currently there is a regex that tries to fix them, but who knows how well that works.
