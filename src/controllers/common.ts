import { CallbackQueryContext, Context } from "grammy";

export const cancel = async (ctx: CallbackQueryContext<Context>) => {
  await ctx.deleteMessage();
  await ctx.answerCallbackQuery();
};
