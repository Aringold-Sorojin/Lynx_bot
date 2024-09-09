import { CallbackQueryContext, Context } from "grammy";
import User from "../models/User";
import crypto from "crypto";
import base58 from "bs58";

export const start = async (ctx: CallbackQueryContext<Context>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  if (!user.refer?.code) {
    const code = base58.encode(crypto.randomBytes(6));
    user.refer = {
      code: `ref_${code}`,
      counts: 0,
      referred: user.refer?.referred,
    };
    await user.save();
  }

  await ctx.reply(
    `<b>Referrals</b>:

Your reflink: https://t.me/lynx_pump_bot?start=${user.refer.code}
  
Referrals: <b>${user.refer.counts}</b>${
      user.refer.referred
        ? `\n\nYou referred to: <b>${user.refer.referred}</b>`
        : ""
    }
  
Refer your friends and earn <b>25%</b> of revenue forever!`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Close", callback_data: "cancel" }]],
      },
    }
  );
};
