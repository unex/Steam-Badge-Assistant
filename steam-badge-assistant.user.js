// ==UserScript==
// @name         Steam Badge Assistant
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Automatically buy all cards for a badge, then craft it.
// @author       notderw
// @website      https://github.com/notderw
// @match        *://steamcommunity.com/*/gamecards/*
// @require      https://code.jquery.com/jquery-3.1.1.min.js
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    var sba = {
        retryLimit: 5, // Number of times to retry failed requests

        init: function() {
            let that = this;

            console.log('INIT SBA');

            GM_addStyle('#sba-bulkbuy { margin: 0 4px 0 0 } .sba-input:not([type="checkbox"]) {color: #909090; background-color: rgba(0, 0, 0, 0.2); border: 1px solid #000; border-radius: 3px; width: 48px; margin: 0 8px;} .sba-input::-webkit-input-placeholder {color: #424242} .sba-input.invalid {background: #B71C1C}');

            let links = $('.gamecards_inventorylink');
            let iter = parseInt(localStorage['sba-craft_iter']);
            if(links && iter) {
                if(iter == -1 || iter > 0) {
                    console.log('ITER DETECTED', iter);
                    that.iterating = true;
                    that.main();
                }
            }
            if(links && $('.badge_card_to_collect').length > 0) links.append('<a class="btn_grey_grey btn_small_thin" href="#" id="sba-bulkbuy"><span>SBA Bulk Buy</span></a>');

            if($('.badge_craft_button').length > 0) {
                if(parseInt(localStorage['sba-craft_badge_now'])) {
                    localStorage['sba-craft_badge_now'] = 0;
                    that.craftBadge();
                }
            }

            $('#sba-bulkbuy').click(function() {
                that.main();
                return false;
            });
        },

        dialog: null,

        // The 'main' function, because I'm not great at titling stuff
        main: function() {
            let that = this;

            that.totalprice = 0; // Total price of current card deck

            that.getDeckInfo().then(function() {
                that.dialog.Dismiss();

                // We only want to show the confirm dialog if we arent in an iteration loop
                if(!that.iterating) {
                    localStorage['sba-deck_max_price'] = '';
                    localStorage['sba-total_max_price'] = '';

                    that.dialog = that.confirmBulkBuy();
                    return that.dialog;
                }
                else {
                    that.deck_max_price = parseFloat(localStorage['sba-deck_max_price']) * 100;
                    that.total_max_price = parseFloat(localStorage['sba-total_max_price']) * 100;

                    console.log('Deck', 'Max: ' + that.deck_max_price, 'Total: ' + that.totalprice);
                    if(that.totalprice > that.deck_max_price) throw ['Complete', 'Deck price is greater than set deck max price'];

                    console.log('Total', 'Max: ' + that.total_max_price, 'Total: ' + that.totalprice);
                    if(that.totalprice > that.total_max_price) throw ['Complete', 'Total price is greater than set max total price'];
                }
            }).then(async function() {
                that.done = 0;
                that.orders = [];

                console.log('ORDERING CARDS');

                that.dialog = ShowBlockingWaitDialog('Purchasing cards', 'Creating buy orders...');

                for(let card of that.cards) {
                    //Wait for makeOrder to finish before trying to order the next card.
                    await that.Order(card);
                }

                // Function will resolve after all orders have completed
                return Promise.all(that.orders);

            }).then(function() {
                if(that.total_max_price) localStorage['sba-total_max_price'] = that.total_max_price - that.totalprice;
                if(parseInt(localStorage['sba-craft_iter']) > 0) localStorage['sba-craft_iter'] = parseInt(localStorage['sba-craft_iter']) - 1;

                if(parseInt(localStorage['sba-auto_craft'])) {
                    that.craftBadge();
                }
                else {
                    that.dialog.Dismiss();
                    that.dialog = ShowAlertDialog('Complete', 'All cards sucessfully bought', 'Reload').then(function() {
                        window.location.reload();
                    });
                }
            }).catch(function(err) {
                console.log('CAUGHT ERROR IN MAIN');
                that.error(err);
            });
        },

        // Get all required information for a card, returns Promise
        getDeckInfo: async function() {
            let that = this,
                requests = [],
                done = 0,
                to_get = $('.badge_card_to_collect');

            if(to_get.length === 0) throw ['No more levels', 'There are no more levels remaining'];

            that.cards = [];
            that.dialog = ShowBlockingWaitDialog('Gathering cards', 'Retrieving cards...');

            to_get.each(function(i, el) {
                let card = {
                        'name': $(el).find('.badge_card_set_text')[0].textContent
                    },
                    url = $(el).find('.btn_grey_grey.btn_medium[href*=market]')[0].href;

                // If you aren't using SSL by now you're dead to me
                if(location.protocol === 'https:') url = url.replace("http://", "https://");

                let req = that.request('POST', url).then(function(html) {
                    if(html.match(/There are no listings for this item\./)) throw ['Market Error', 'There are no listings for: <a href="' + url + '" target="_blank">' + card.name + '</a>'];

                    let marketID = html.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\);/),
                        sessionID = html.match(/g_sessionID = "(.+)";/),
                        countryCode = html.match(/g_strCountryCode = "([a-zA-Z0-9]+)";/),
                        currency = html.match(/"wallet_currency":(\d)/),
                        hashName = html.match(/"market_hash_name":"([^"]+)"/);

                    if(!marketID || !sessionID || !countryCode || !currency || !hashName) {
                        // This should never happen but you never know.
                        console.log(marketID, sessionID, countryCode, currency, hashName);
                        throw new Error("marketID, sessionID, countryCode, currency, hashName not found");
                    }

                    that.currency = currency[1];
                    that.sessionID = sessionID[1];

                    // TODO: This needs to be unescaped to fix escaped unicode but apperently theres no frigging way to do that so kill me
                    card.hashname = hashName[1];

                    // This is kinda a temp fix, it checks for escaped unicode and grabs the hash from he market url if true
                    if(/\\u([0-9a-f]{4})/gi.test(hashName[1])) card.hashname = decodeURIComponent(url.split('/').slice(-1)[0]);

                    return {
                        'country': countryCode[1],
                        'id': marketID[1]
                    };

                }).then(function(d) {
                    return that.request('GET', '/market/itemordershistogram', {"country": d.country, language: 'english', "currency": that.currency, "item_nameid": d.id});
                }).then(function(json) {
                    if(!json.lowest_sell_order) throw ['Market Error', 'There are no active listings for: <a href="' + url + '" target="_blank">' + card.name + '</a>'];

                    card.price = json.lowest_sell_order;

                    that.totalprice += parseInt(card.price);

                    that.cards.push(card);

                    if(!that.errored) {
                        that.dialog.Dismiss();
                        that.dialog = ShowBlockingWaitDialog('Gathering cards', 'Retrieved ' + ++done + ' / ' + to_get.length);
                    }
                });

                requests.push(req);
            });

            return Promise.all(requests);
        },

        // Create confirmation modal, returns CModal
        confirmBulkBuy: function() {
            let that = this;

            let dialog = ShowConfirmDialog('Steam Badge Assistant', function() {
                let content = [];

                content.push('<table>');

                that.cards.forEach(function(card) {
                    content.push('<tr><td><b>' + card.name + ' </b></td><td style="padding-left: 8px">' + that.formatPrice((parseInt(card.price) / 100).toFixed(2)) + '</td></tr>');
                });

                content.push('<tr><td>&nbsp;</td></tr>');
                content.push('<tr><td style="text-align:right"><b>Total </b></td><td style="padding-left: 8px">' + that.formatPrice((that.totalprice / 100).toFixed(2).toString()) + '</td></tr>');

                content.push('</table>');

                content.push('<br>');

                content.push('<p><input type="checkbox" id="sba-auto_craft" class="sba-input"><label for="reload-and-craft">Automatically craft badge</label></p>');

                content.push('<br>');

                content.push('<h3>Advanced Options</h3>');

                content.push('<p><span>Craft iterations:</span><input type="number" id="sba-craft_iter" class="sba-input" value="1" min="-1"><span>(-1 for inifinite until done)</span></p>');
                content.push('<p><span>Craft while deck $ is less than:</span><input type="text" id="sba-deck_max_price" class="sba-input" placeholder="0.00"><span>(works best when a few cents higher than current total)</span></p>');
                content.push('<p><span>Craft while total spent is less than:</span><input type="text" id="sba-total_max_price" class="sba-input" placeholder="0.00"></p>');

                return $(content.join('\n'));
            });

            if(parseInt(localStorage['sba-auto_craft'])) {
                $('#sba-auto_craft').prop('checked', true);
            }

            $('.sba-input').change(function() {
                let input = $(this),
                    val = input.val();

                if(input.attr('type') == 'checkbox') {
                    localStorage[input[0].id] = input.prop('checked') ? 1 : 0;
                    return;
                }

                if(input[0].id == 'sba-craft_iter') {
                    if(val == '0' || val < -1)  input.addClass('invalid');
                    else input.removeClass('invalid');
                }
                else {
                    if(val < 0) input.removeClass('invalid');
                    else input.removeClass('invalid');
                }

                localStorage[input[0].id] = val;
            });

            return dialog;
        },

        // Buy a card, returns Promise
        Order: async function(card) {
            let that = this;

            // We await this to force the loop to wait for the order to process.
            // Steam will get angry if we try to buy more than one card at a time.
            await that.makeOrder(card);

            // We can let these overlap as much as we want, Steam doesnt care.
            let order = that.verifyOrder(card);

            order.then(function() {
                that.dialog.Dismiss();
                that.dialog = ShowBlockingWaitDialog('Purchasing cards', 'Purchased ' + ++that.done + ' / ' + that.cards.length);
                console.log('VERIFIED', card.name);
            });

            that.orders.push(order);
        },

        // Create a buy order for card, returns Promise
        makeOrder: async function(card) {
            let that = this;

            return that.request('POST', '/market/createbuyorder/', {"sessionid": that.sessionID, "currency": that.currency, "appid": 753, "market_hash_name": card.hashname, "price_total": card.price, "quantity": 1}).then(function(json) {
                if(json instanceof Error) throw ['Market Error', json];

                card.orderid = json.buy_orderid;
                card.checks = 0;
                console.log('ORDERED', card.name);
            });
        },

        // Verify that card was purchased, returns Promise
        verifyOrder: function(card) {
            let that = this;

            return new Promise(function(resolve, reject) {
                (function vo() {
                    that.request('GET', '/market/getbuyorderstatus/', {"sessionid": that.sessionID, "buy_orderid": card.orderid}).then(function(json) {
                        if(json.purchases.length) {
                            card.purchased = true;

                            resolve();
                        }

                        if(!json.purchases.length) {
                            if(card.checks > 10) {
                                that.cancelOrder(card).then(that.Order(card))
                            }
                            else {
                                ++card.checks;

                                vo();
                            }
                        }
                    });
                })();
            });
        },

        // Cancel a card order, returns Promise
        cancelOrder: async function(card) {
            let that = this;

            console.log('Cancelled ' + card.name);

            return that.request('POST', '/market/cancelbuyorder/', {"sessionid": that.sessionID, "buy_orderid": card.orderid});
        },

        // Instantly crafts the current badge
        craftBadge: function() {
            let that = this;

            localStorage['sba-craft_badge_now'] = 1;

            if(that.dialog) that.dialog.Dismiss();
            that.dialog = ShowBlockingWaitDialog('Crafting', 'Crafting Badge');

            // These are super jenky but it works so whatever
            let url = $('.user_avatar.playerAvatar')[0].href + 'ajaxcraftbadge/',
                appid = $('.whiteLink[href*="/gamecards/"]')[0].href.split('/').slice(-2)[0],
                series = parseInt($('.badge_card_set_text')[1].innerText.toLowerCase().split('series').slice(-1)[0]);

            // Fire request to craft the badge
            that.request('POST', url, { appid: appid, series: series, border_color: 0, sessionid: that.sessionID }).then(function(data) {
                localStorage['sba-craft_badge_now'] = 0;

                that.dialog.Dismiss();

                window.location.reload();
            });
        },

        // AJAX wrapper, with general error handling for Steam, and retry support
        request: function(type, url, data = {}) {
            let that = this;

            return new Promise(function(resolve, reject) {
                let retry = $.ajax; // Alias retry to $.ajax for readability

                $.ajax({
                    url : url,
                    type : type,
                    data : data,
                    tryCount : 0,
                    retryLimit : that.retryLimit,
                    success : function(data) {
                        if(typeof(data) == 'object' && 'success' in data) {
                            if(data.success == 30) console.log('30 ALERT', data); // I can't remember what the code 30 is for so if it happens I want to know about it.
                            if(data.success !== 1 && data.success !== 29 && data.success !== 30) {
                                this.tryCount++;
                                console.error('ERROR IN REQUEST', data, '(Retry ' + this.tryCount + '/' + this.retryLimit + ')');
                                if (this.tryCount <= this.retryLimit) {
                                    retry(this);
                                    return;
                                }
                                else {
                                    // Codes that commonly occur if your wallet is empty
                                    if(data.success == 42 || data.success == 78) reject(new Error('There was a problem purchasing cards, you may need to <a href="https://store.steampowered.com/steamaccount/addfunds" target="_blank">add funds to your Steam wallet</a>'));

                                    reject(new Error(data.message));
                                }
                            }
                        }

                        resolve(data);
                    },
                    error : function(xhr, status, error) {
                        this.tryCount++;
                        console.error('ERROR IN REQUEST', xhr, status, error, '(Retry ' + this.tryCount + '/' + this.retryLimit + ')');
                        if(xhr.status == 400) reject(new Error(xhr.status + ', ' + error)); return;
                        if (this.tryCount <= this.retryLimit) {
                            //try again
                            retry(this);
                            return;
                        }
                        else reject(new Error(errorThrown));
                    }
                });
            }).catch(function(err) {
                console.error('FAILURE IN REQUEST', type, url, JSON.stringify(data), err);

                return err;
            });
        },

        error: function(obj) {
            let that = this;

            console.error(obj);

            that.errored = true;

            if(that.dialog) that.dialog.Dismiss();

            if(obj instanceof Error) {
                ShowAlertDialog('CATASTROPHIC FAILURE', obj.message);
                return;
            }

            localStorage['sba-craft_iter'] = 0;
            ShowAlertDialog(obj[0], obj[1].message || obj[1]);
        },

        sessionID: g_sessionID, // User sessionID required to make API requests
        //sessionID: $('body')[0].outerHTML.match(/g_sessionID = "(.+)";/), // User sessionID required to make API requests

        currency: 1, // Current currency (numerical identifier used by Steam)
        currencyInfo: { // Detailed information for each currency ID (using information taken from Steam's Javascript source code)
            1: { symbol: "$", separator: "." },
            2: { symbol: "£", separator: "." },
            3: { symbol: "€", separator: "," },
            5: { symbol: "RUB", separator: "," }, // No unicode support for the new symbol yet
            7: { symbol: "R$", separator: "," }
        },

        // Formats a price based on the users currency
        formatPrice: function(price) {
            return this.currencyInfo[this.currency].symbol + price.replace(".", this.currencyInfo[this.currency].separator);
        }
    };

    sba.init();
})();
