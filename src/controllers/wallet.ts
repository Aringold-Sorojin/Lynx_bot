import { CallbackQueryContext, Context } from "grammy";

import * as web3 from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import User from "../models/User";
import base58 from "bs58";
import { Conversation, ConversationFlavor } from "@grammyjs/conversations";
import { sleep } from "../utils";

type CusContext = Context & ConversationFlavor;
type CusConversation = Conversation<CusContext>;

const walletCardContent = (wallet: web3.Keypair, balance: number) => {
  return [
    `<b>Your Wallet:</b>\n\nAddress: <code>${
      wallet.publicKey
    }</code>\nBalance: <b>${
      balance / web3.LAMPORTS_PER_SOL
    }</b> SOL\n\n Tap to copy the address and send SOL to deposit.`,
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "View on Solscan",
              url: `https://solscan.io/address/${wallet.publicKey}`,
            },
            { text: "Close", callback_data: "cancel" },
          ],
          [
            { text: "Deposit SOL", callback_data: "wallet_deposit" },
            {
              text: "Withdraw SOL",
              callback_data: "wallet_withdraw",
            },
          ],
          [
            { text: "Reset Wallet", callback_data: "wallet_reset" },
            {
              text: "Export Private Key",
              callback_data: "wallet_export",
            },
          ],
          [{ text: "Refresh", callback_data: "wallet_refresh" }],
        ],
      },
    },
  ];
};

export const start = async (ctx: CallbackQueryContext<Context>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
  const connection = new web3.Connection(web3.clusterApiUrl("mainnet-beta"));
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(balance);

  //@ts-ignore
  await ctx.reply(...walletCardContent(wallet, balance));
  await ctx.answerCallbackQuery();
};

export const reset = async (ctx: CallbackQueryContext<Context>) => {
  await ctx.reply(
    "Are you sure you want to reset your <b>LynxBot Wallet</b>?\n\n<b>WARNING: This action is irreversible!</b>\n\nLynxBot will generate a new wallet for you and discard your old one.",
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Cancel", callback_data: "cancel" },
            {
              text: "Confirm",
              callback_data: "wallet_reset_confirm",
            },
          ],
        ],
      },
    }
  );
  await ctx.answerCallbackQuery();
};

export const resetConfirm = async (ctx: CallbackQueryContext<Context>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const wallet = web3.Keypair.generate();
  user.wallet = base58.encode(wallet.secretKey);

  await user.save();

  await ctx.reply(
    `<b>Success:</b> Your new wallet is:\n\n<code>${wallet.publicKey}</code>\n\nYou can now send SOL to this address to deposit into your new wallet. Press refresh to see your new wallet.`,
    {
      parse_mode: "HTML",
    }
  );
  await ctx.answerCallbackQuery();
};

export const exportPrvkey = async (ctx: CallbackQueryContext<Context>) => {
  await ctx.reply("Are you sure you want to export your <b>Private Key</b>?", {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Cancel", callback_data: "cancel" },
          {
            text: "Confirm",
            callback_data: "wallet_export_confirm",
          },
        ],
      ],
    },
  });
  await ctx.answerCallbackQuery();
};

export const exportPrvkeyConfirm = async (
  ctx: CallbackQueryContext<Context>
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  await ctx.reply(
    `Your <b>Private Key</b> is:
  <code>${user.wallet}</code>
  
   You can now i.e. import the key into a wallet like Solflare. (tap to copy).
  Delete this message once you are done.`,
    {
      parse_mode: "HTML",
    }
  );
  await ctx.answerCallbackQuery();
};

export const refresh = async (ctx: CallbackQueryContext<Context>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
  const connection = new web3.Connection(
    "https://basic.ligmanode.com/v1/92077c6d-9a1d-4a2f-b65e-0ae3746c74a5/"
  );
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(balance);

  try {
    // @ts-ignore
    await ctx.editMessageText(...walletCardContent(wallet, balance));
  } catch (err) {
    console.log(err);
  }
  await ctx.answerCallbackQuery();
};

export const deposit = async (ctx: CallbackQueryContext<Context>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));

  await ctx.reply(
    `To deposit send SOL to below address:\n\n<code>${wallet.publicKey}</code>`,
    {
      parse_mode: "HTML",
    }
  );
  await ctx.answerCallbackQuery();
};

export const withdrawConversation = async (
  conversation: CusConversation,
  ctx: CusContext
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
  const connection = new web3.Connection(
    "https://basic.ligmanode.com/v1/92077c6d-9a1d-4a2f-b65e-0ae3746c74a5/"
  );
  const balance = await connection.getBalance(wallet?.publicKey ?? "");
  await ctx.reply(
    `<b>Balance</b>: ${
      balance / web3.LAMPORTS_PER_SOL
    } SOL\n\nEnter <b>SOL</b> amount to withdraw:`,
    {
      parse_mode: "HTML",
    }
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
      parseFloat(amount) * web3.LAMPORTS_PER_SOL <= balance - 5000
    ) {
      break;
    }
    await ctx.reply("<i>Invalid SOL amount</i>", { parse_mode: "HTML" });
  } while (true);
  await ctx.reply("Enter recipient address:");
  let recipient;
  do {
    const {
      msg: { text },
    } = await conversation.waitFor("message");
    try {
      recipient = new web3.PublicKey(text ?? "");
      break;
    } catch (err) {
      console.log(err);
      await ctx.reply("<i>Invalid recipient address</i>", {
        parse_mode: "HTML",
      });
    }
  } while (true);
  await ctx.reply(`<i>Withdrawing SOL...</i>`, {
    parse_mode: "HTML",
  });

  const latestBlock = await connection
    .getLatestBlockhash("finalized")
    .then((e) => e.blockhash);

  console.log("latest block:", latestBlock);

  try {
    const txs = new web3.VersionedTransaction(
      new web3.TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: latestBlock,
        instructions: [
          web3.ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: user.fee * web3.LAMPORTS_PER_SOL,
          }),
          web3.SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: recipient,
            lamports: Number(amount) * web3.LAMPORTS_PER_SOL,
          }),
        ],
      }).compileToV0Message()
    );

    const signed = await new anchor.Wallet(wallet).signTransaction(txs);
    const rawTx = signed.serialize();

    let hash: any;
    for (let i = 0; i < 1; i++) {
      try {
        hash = await connection.sendRawTransaction(rawTx, {
          skipPreflight: true,
        });
        const latestBlock = await connection.getLatestBlockhash("finalized");
        connection
          .confirmTransaction(
            {
              blockhash: latestBlock.blockhash,
              lastValidBlockHeight: latestBlock.lastValidBlockHeight,
              signature: hash,
            },
            "confirmed"
          )
          .then(async (res) => {
            if (!res.value.err) {
              await ctx.reply(
                `Transaction submitted\nhttps://solscan.io/tx/${hash}`
              );
              await sleep(1000);
              await ctx.reply("Transaction Successful");
            } else {
              await ctx.reply("<i>Failed to withdraw SOL</i>", {
                parse_mode: "HTML",
              });
            }
          });
        // await connection.confirmTransaction(hash, 'confirmed')
      } catch (err) {
        console.log(err);
        await ctx.reply("<i>Failed to withdraw SOL</i>", {
          parse_mode: "HTML",
        });
      }
    }
  } catch (err) {
    console.log(err);
    await ctx.reply("<i>Failed to withdraw SOL</i>", { parse_mode: "HTML" });
  }
};

export const withdraw = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.reenter("wallet-withdraw");

  await ctx.answerCallbackQuery();
};
