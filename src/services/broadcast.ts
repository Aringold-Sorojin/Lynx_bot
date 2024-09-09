import { Api, Bot, Context, RawApi } from "grammy";
import User from "../models/User";
import { ConversationFlavor } from "@grammyjs/conversations";

type CusContext = Context & ConversationFlavor;

export const latestBroadcast = (bot: Bot<CusContext, Api<RawApi>>) => {
  let prevToken: any;
  setInterval(async () => {
    try {
      const solPrice = await fetch(
        "https://client-api-2-74b1891ee9f9.herokuapp.com/sol-price"
      ).then((res) => res.json());
      const latest = await fetch(
        "https://client-api-2-74b1891ee9f9.herokuapp.com/coins/latest"
      ).then((res) => res.json());
      if (!prevToken || prevToken !== latest.mint) {
        prevToken = latest.mint;
        const users = await User.find({ latest: true });
        users.forEach((user) => {
          bot.api.sendPhoto(user.user, latest.image_uri, {
            caption: `<b>${latest.name}</b> (${
              latest.symbol
            })\nView on Pump: <a href="https://www.pump.fun/${latest.mint}">${
              latest.name
            }</a>\n\n<b>MarketCap:</b> $${
              latest.market_cap * solPrice.solPrice
            }\n\n<b>${latest.mint}</b>`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: `Buy ${user.buys?.[0] ?? "0.1"} SOL`,
                    callback_data: "buy_1_amount",
                  },
                  { text: "Buy X Amount", callback_data: "buy_x_amount" },
                  {
                    text: `Buy ${user.buys?.[1] ?? "1"} SOL`,
                    callback_data: "buy_2_amount",
                  },
                ],
                [
                  {
                    text: "View on Pump",
                    url: `https://www.pump.fun/${latest.mint}`,
                  },
                ],
                [
                  {
                    text: "Refresh",
                    callback_data: "buy_refresh",
                  },
                  { text: "Cancel", callback_data: "cancel" },
                ],
              ],
            },
          });
        });
      }
    } catch (err) {
      // console.log(err);
    }
  }, 3000);
};
