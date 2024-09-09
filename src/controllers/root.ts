import { CommandContext, Context } from "grammy";
import * as web3 from "@solana/web3.js";
import User from "../models/User";
import base58 from "bs58";
import { settingsContent } from "./settings";

export const start = async (ctx: CommandContext<Context>) => {
  const id = ctx.message?.from.id;

  const referral = ctx.message?.text?.replace("/start", "")?.trim();

  let user = await User.findOne({ user: id });

  if (!user) {
    const newWallet = web3.Keypair.generate();
    user = new User({
      user: id,
      wallet: base58.encode(newWallet.secretKey),
      trades: [],
    });
    await user.save();
  }

  if (referral && referral.includes("ref_")) {
    const refer = await User.findOne({ "refer.code": referral });
    if (refer) {
      refer.refer = { ...refer.refer, counts: (refer.refer?.counts ?? 0) + 1 };
      user.refer = { ...user.refer, referred: referral };
      await refer.save();
      await user.save();
    }
  }

  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
  const connection = new web3.Connection(web3.clusterApiUrl("mainnet-beta"));
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(balance);

  await ctx.reply(
    `<b>Welcome to LynxBot</b>\n\nThe fastest bot to trade any coin on PUMPFUN.\n\n${
      balance === 0
        ? "You currently have no SOL balance. To get started with trading, send some SOL to your LynxBot wallet address:"
        : `Your balance is <b>${
            balance / web3.LAMPORTS_PER_SOL
          }</b> SOL. You can start trading with your LynxBot wallet address:`
    } \n\n<code>${
      wallet.publicKey
    }</code> (tap to copy)\n\nOnce done tap refresh and your balance will appear here.\n\nTo buy a token just enter the pump.fun link of the coin.\n\nFor more info on your wallet and to retrieve your private key, tap the wallet button below. We can guarantee the safety of user funds on LynxBot, as long as private key is not exposed.`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Buy", callback_data: "buy" },
            { text: "Sell", callback_data: "sell" },
          ],
          [
            { text: "Wallet", callback_data: "wallet" },
            {
              text: "Refer",
              callback_data: "refer",
            },
            {
              text: "Settings",
              callback_data: "settings",
            },
          ],

          [{ text: "Refresh", callback_data: "refresh" }],
        ],
      },
    }
  );
};

export const settings = async (ctx: CommandContext<Context>) => {
  const id = ctx.message?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    const newWallet = web3.Keypair.generate();
    user = new User({
      user: id,
      wallet: base58.encode(newWallet.secretKey),
    });
    await user.save();
  }

  //@ts-ignore
  await ctx.reply(...settingsContent(user));
};

export const bots = async (ctx: CommandContext<Context>) => {
  await ctx.reply(`BOTS`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "Close", callback_data: "cancel" }]],
    },
  });
};

export const help = async (ctx: CommandContext<Context>) => {
  await ctx.reply(
    `Boost Your Trading Profits with the Fastest PUMP.FUN Telegram Bot.\nhttps://t.me/LynxBotHelp`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Close", callback_data: "cancel" }]],
      },
    }
  );
};

export const chat = async (ctx: CommandContext<Context>) => {
  await ctx.reply(`CHAT`, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "Close", callback_data: "cancel" }]],
    },
  });
};

export const latest = async (ctx: CommandContext<Context>) => {
  const id = ctx.message?.from?.id;

  await User.findOneAndUpdate({ user: id }, { latest: true });
  await ctx.reply("You will receive new tokens.");
};

export const stop = async (ctx: CommandContext<Context>) => {
  const id = ctx.message?.from?.id;

  await User.findOneAndUpdate({ user: id }, { latest: false });
  await ctx.reply("You have sucessfully stopped receiving new tokens.");
};
