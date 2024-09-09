import { CallbackQueryContext, Context } from "grammy";

import User from "../models/User";
import { Conversation, ConversationFlavor } from "@grammyjs/conversations";

type CusContext = Context & ConversationFlavor;
type CusConversation = Conversation<CusContext>;

const priorityFeeLabels = [
  { text: "Medium", value: 0.005 },
  { text: "High", value: 0.01 },
  { text: "Very High", value: 0.03 },
];

export const settingsContent = (user: any) => {
  return [
    "<b>Settings:</b>\n\n<b>SLIPPAGE CONFIG</b>\nCustomize your slippage settings for buys and sells. Tap to edit.\nMax Price Impact is to protect against trades in extremely illiquid pools.\n\n<b>AUTO BUY</b>\nImmediately buy when pasting token address or Pump.fun URL. Tap to toggle.\n\n<b>BUY BUTTONS</b>\nCustomize your buy buttons for your dashboard when you are buying a token. Tap each one of the buttons to edit.\n\n<b>SELL BUTTONS</b>\nCustomize your sell buttons for your dashboard when you are selling a token. Tap each one of the buttons to edit.\n\n<b>TRANSACTION PRIORITY</b>\nIncrease your Transaction Priority to improve transaction speed. Select preset or tap to edit.",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "--- SLIPPAGE CONFIG ---",
              callback_data: "settings_slippage_title",
            },
          ],
          [
            {
              text: `${user.slippage ?? 15}%`,
              callback_data: "settings_slippage",
            },
          ],
          [{ text: "--- AUTO BUY ---", callback_data: "auto_buy_title" }],
          [
            {
              text: user.autobuy?.actived ? "Activated 🟢" : "Deactivated 🔴",
              callback_data: "auto_buy_active",
            },
            {
              text: `${user.autobuy?.amount ?? 1} SOL`,
              callback_data: "auto_buy_amount",
            },
          ],
          [{ text: "--- BUY BUTTONS ---", callback_data: "buy_buttons_title" }],
          [
            {
              text: `${user.buys?.[0] ?? 0.1} SOL`,
              callback_data: "buy_buttons_1",
            },
            {
              text: `${user.buys?.[1] ?? 1} SOL`,
              callback_data: "buy_buttons_2",
            },
          ],
          [
            {
              text: "--- SELL BUTTONS ---",
              callback_data: "sell_buttons_title",
            },
          ],
          [
            {
              text: `${user.sells?.[0] ?? 50} %`,
              callback_data: "sell_buttons_1",
            },
            {
              text: `${user.sells?.[1] ?? 100} %`,
              callback_data: "sell_buttons_2",
            },
          ],
          [
            {
              text: "--- TRANSACTION PRIORITY ---",
              callback_data: "settings_tx_priority_title",
            },
          ],
          [
            {
              text:
                priorityFeeLabels.find((item) => item.value === user.fee)
                  ?.text ?? "Custom",
              callback_data: "settings_tx_priority_switch",
            },
            {
              text: `${(user.fee ?? 0.001).toFixed(6)} SOL`,
              callback_data: "settings_tx_priority_input",
            },
          ],
          [{ text: "Cancel", callback_data: "cancel" }],
        ],
      },
    },
  ];
};

export const start = async (ctx: CallbackQueryContext<CusContext>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  //@ts-ignore
  await ctx.reply(...settingsContent(user));

  await ctx.answerCallbackQuery();
};

export const slippageConversation = async (
  conversation: CusConversation,
  ctx: CusContext
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  await ctx.reply(
    "Enter your new slippage setting in % (0 - 50%). Example: 5",
    { reply_markup: { force_reply: true } }
  );

  let amount;
  do {
    const { msg } = await conversation.waitFor("message");
    amount = msg.text;
    if (
      amount &&
      !isNaN(Number(amount)) &&
      !isNaN(parseFloat(amount)) &&
      parseFloat(amount) > 0 &&
      parseFloat(amount) <= 50
    ) {
      break;
    }
    await ctx.reply("<i>Invalid slippage amount</i>", { parse_mode: "HTML" });
  } while (true);
  user.slippage = parseInt(amount);
  await user.save();
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup:
        // @ts-ignore
        settingsContent(user)[1].reply_markup,
    });
  } catch (err) {}
  await ctx.reply(`Your slippage set to ${parseInt(amount)}%.`);
};

export const slippage = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.enter("slippage");
  await ctx.answerCallbackQuery();
};

export const prioritySwitch = async (ctx: CallbackQueryContext<CusContext>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const curStep = priorityFeeLabels.findIndex(
    (item) => item.value === user?.fee
  );
  console.log(curStep);
  const fee = priorityFeeLabels[(curStep + 1) % 3];
  user.fee = fee.value;
  await user.save();
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup:
        // @ts-ignore
        settingsContent(user)[1].reply_markup,
    });
  } catch (err) {}
  await ctx.reply(`Priority Fee set to ${fee.text}`);

  await ctx.answerCallbackQuery();
};

export const priorityConversation = async (
  conversation: CusConversation,
  ctx: CusContext
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  await ctx.reply(
    "Enter your new Transaction Priority Setting for sells in SOL. Example: 0.0001 SOL",
    { reply_markup: { force_reply: true } }
  );

  let amount;
  do {
    const { msg } = await conversation.waitFor("message");
    amount = msg.text;
    if (
      amount &&
      !isNaN(Number(amount)) &&
      !isNaN(parseFloat(amount)) &&
      parseFloat(amount) > 0 &&
      parseFloat(amount) <= 1
    ) {
      break;
    }
    await ctx.reply("<i>Invalid priority fee amount</i>", {
      parse_mode: "HTML",
    });
  } while (true);
  user.fee = Number(amount);
  await user.save();
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup:
        // @ts-ignore
        settingsContent(user)[1].reply_markup,
    });
  } catch (err) {}
  await ctx.reply(`Priority Fee set to ${Number(amount)} SOL`);
};

export const priorityInput = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.enter("priority");
  await ctx.answerCallbackQuery();
};

export const autoBuyActive = async (ctx: CallbackQueryContext<CusContext>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const actived = !user.autobuy?.actived;
  user.autobuy = { actived: actived, amount: user.autobuy?.amount };
  await user.save();
  try {
    await ctx.editMessageReplyMarkup({
      // @ts-ignore
      reply_markup: settingsContent(user)[1].reply_markup,
    });
  } catch (err) {}
  await ctx.reply(`Auto Buy ${actived ? "Activated 🟢" : "Deactivated 🔴"}`);

  await ctx.answerCallbackQuery();
};

export const autoBuyAmountConversation = async (
  conversation: CusConversation,
  ctx: CusContext
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  await ctx.reply("Enter your new Auto Buy Amount in SOL. Example: 0.5", {
    reply_markup: { force_reply: true },
  });
  const {
    msg: { text: amount },
  } = await conversation.waitFor("message");

  if (
    !amount ||
    isNaN(Number(amount)) ||
    isNaN(parseFloat(amount)) ||
    parseFloat(amount) <= 0
  ) {
    await ctx.reply("<i>Invalid auto buy amount</i>", { parse_mode: "HTML" });
    return;
  }
  user.autobuy = {
    actived: user.autobuy?.actived,
    amount: Number(amount),
  };
  await user.save();
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup:
        // @ts-ignore
        settingsContent(user)[1].reply_markup,
    });
  } catch (err) {}
  await ctx.reply(`Amount Buy Amount set to ${Number(amount)} SOL`);
};

export const autoBuyAmount = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.enter("autobuy");

  await ctx.answerCallbackQuery();
};

export const buyButton1Conversation = async (
  conversation: CusConversation,
  ctx: CusContext
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  await ctx.reply("Enter your new Buy Amount in SOL. Example: 0.5", {
    reply_markup: { force_reply: true },
  });
  const {
    msg: { text: amount },
  } = await conversation.waitFor("message");

  if (
    !amount ||
    isNaN(Number(amount)) ||
    isNaN(parseFloat(amount)) ||
    parseFloat(amount) <= 0
  ) {
    await ctx.reply("<i>Invalid buy amount</i>", { parse_mode: "HTML" });
    return;
  }
  user.buys = [Number(amount), user.buys?.[1] ?? 1];
  await user.save();
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup:
        // @ts-ignore
        settingsContent(user)[1].reply_markup,
    });
  } catch (err) {}
  await ctx.reply(`Buy Amount set to ${Number(amount)} SOL`);
};

export const buyButton1 = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.enter("buybutton1");
  await ctx.answerCallbackQuery();
};

export const buyButton2Conversation = async (
  conversation: CusConversation,
  ctx: CusContext
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  await ctx.reply("Enter your new Buy Amount in SOL. Example: 0.5", {
    reply_markup: { force_reply: true },
  });
  const {
    msg: { text: amount },
  } = await conversation.waitFor("message");

  if (
    !amount ||
    isNaN(Number(amount)) ||
    isNaN(parseFloat(amount)) ||
    parseFloat(amount) <= 0
  ) {
    await ctx.reply("<i>Invalid buy amount</i>", { parse_mode: "HTML" });
    return;
  }
  user.buys = [user.buys?.[0] ?? 0.1, Number(amount)];
  await user.save();
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup:
        // @ts-ignore
        settingsContent(user)[1].reply_markup,
    });
  } catch (err) {}
  await ctx.reply(`Buy Amount set to ${Number(amount)} SOL`);
};

export const buyButton2 = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.enter("buybutton2");
  await ctx.answerCallbackQuery();
};

export const sellButton1Conversation = async (
  conversation: CusConversation,
  ctx: CusContext
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  await ctx.reply("Enter your new Sell Amount in % (1 - 100). Example: 5%", {
    reply_markup: { force_reply: true },
  });
  const {
    msg: { text: amount },
  } = await conversation.waitFor("message");

  if (
    !amount ||
    isNaN(Number(amount)) ||
    isNaN(parseFloat(amount)) ||
    parseInt(amount) <= 0 ||
    parseInt(amount) > 100
  ) {
    await ctx.reply("<i>Invalid sell amount</i>", { parse_mode: "HTML" });
    return;
  }
  user.sells = [parseInt(amount), user.sells?.[1] ?? 100];
  await user.save();
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup:
        // @ts-ignore
        settingsContent(user)[1].reply_markup,
    });
  } catch (err) {}
  await ctx.reply(`Sell Amount set to ${parseInt(amount)} %`);
};

export const sellButton1 = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.enter("sellbutton1");
  await ctx.answerCallbackQuery();
};

export const sellButton2Conversation = async (
  conversation: CusConversation,
  ctx: CusContext
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  await ctx.reply("Enter your new Sell Amount in % (1 - 100). Example: 5%", {
    reply_markup: { force_reply: true },
  });
  const {
    msg: { text: amount },
  } = await conversation.waitFor("message");

  if (
    !amount ||
    isNaN(Number(amount)) ||
    isNaN(parseFloat(amount)) ||
    parseInt(amount) <= 0 ||
    parseInt(amount) > 100
  ) {
    await ctx.reply("<i>Invalid sell amount</i>", { parse_mode: "HTML" });
    return;
  }
  user.sells = [user.sells?.[0] ?? 50, parseInt(amount)];
  await user.save();
  try {
    await ctx.editMessageReplyMarkup({
      reply_markup:
        // @ts-ignore
        settingsContent(user)[1].reply_markup,
    });
  } catch (err) {}
  await ctx.reply(`Sell Amount set to ${parseInt(amount)} %`);
};

export const sellButton2 = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.enter("sellbutton2");
  await ctx.answerCallbackQuery();
};
