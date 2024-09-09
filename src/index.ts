import { Bot, Context, session } from "grammy";
import {
  type Conversation,
  type ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import config from "./config";

import connectDB from "./config/db";

import {
  common,
  refer,
  root,
  settings,
  buy,
  sell,
  wallet,
} from "./controllers";
import { latestBroadcast } from "./services/broadcast";

type CusContext = Context & ConversationFlavor;

const bot = new Bot<CusContext>(config.TG_BOT_TOKEN);

(async function () {
  try {
    await connectDB();

    bot.use(
      session({
        initial() {
          return {};
        },
      })
    );

    bot.use(conversations());
    bot.command("start", root.start);
    bot.command("settings", root.settings);
    bot.command("bots", root.bots);
    bot.command("help", root.help);
    bot.command("chat", root.chat);
    bot.command("latest", root.latest);
    bot.command("stop", root.stop);

    latestBroadcast(bot);

    bot.callbackQuery("cancel", common.cancel);
    // wallet callback
    bot.callbackQuery("wallet", wallet.start);
    bot.callbackQuery("wallet_reset", wallet.reset);
    bot.callbackQuery("wallet_reset_confirm", wallet.resetConfirm);
    bot.callbackQuery("wallet_export", wallet.exportPrvkey);
    bot.callbackQuery("wallet_export_confirm", wallet.exportPrvkeyConfirm);
    bot.callbackQuery("wallet_refresh", wallet.refresh);
    bot.callbackQuery("wallet_deposit", wallet.deposit);
    bot.use(createConversation(wallet.withdrawConversation, "wallet-withdraw"));
    bot.callbackQuery("wallet_withdraw", wallet.withdraw);

    // buy callback
    bot.use(createConversation(buy.buyConversation, "buy"));
    bot.callbackQuery("buy", buy.buy);
    bot.callbackQuery("buy_1_amount", buy.buy1Amount);
    bot.use(createConversation(buy.buyXConversation, "buyX"));
    bot.callbackQuery("buy_x_amount", buy.buyxAmount);
    bot.callbackQuery("buy_2_amount", buy.buy2Amount);

    // sell callback
    bot.use(createConversation(sell.sellConversation, "sell"));
    bot.callbackQuery("sell", sell.sell);
    bot.callbackQuery("sell_1_amount", sell.sell1Amount);
    bot.use(createConversation(sell.sellXConversation, "sellX"));
    bot.callbackQuery("sell_x_amount", sell.sellxAmount);
    bot.callbackQuery("sell_2_amount", sell.sell2Amount);
    bot.callbackQuery("sell_refresh", sell.sellRefresh);

    // settings callback
    bot.callbackQuery("settings", settings.start);
    bot.use(createConversation(settings.slippageConversation, "slippage"));
    bot.callbackQuery("settings_slippage", settings.slippage);
    bot.callbackQuery("settings_tx_priority_switch", settings.prioritySwitch);
    bot.use(createConversation(settings.priorityConversation, "priority"));
    bot.callbackQuery("settings_tx_priority_input", settings.priorityInput);
    bot.callbackQuery("auto_buy_active", settings.autoBuyActive);
    bot.use(createConversation(settings.autoBuyAmountConversation, "autobuy"));
    bot.callbackQuery("auto_buy_amount", settings.autoBuyAmount);
    bot.use(createConversation(settings.buyButton1Conversation, "buybutton1"));
    bot.callbackQuery("buy_buttons_1", settings.buyButton1);
    bot.use(createConversation(settings.buyButton2Conversation, "buybutton2"));
    bot.callbackQuery("buy_buttons_2", settings.buyButton2);
    bot.use(
      createConversation(settings.sellButton1Conversation, "sellbutton1")
    );
    bot.callbackQuery("sell_buttons_1", settings.sellButton1);
    bot.use(
      createConversation(settings.sellButton2Conversation, "sellbutton2")
    );
    bot.callbackQuery("sell_buttons_2", settings.sellButton2);

    // refer callback
    bot.callbackQuery("refer", refer.start);

    bot.catch((err) => console.log(err));

    bot.start();
  } catch (err) {
    console.log(err);
  }
})();
