import { CallbackQueryContext, Context } from "grammy";
import * as anchor from "@coral-xyz/anchor";
import * as web3 from "@solana/web3.js";
import * as splToken from "@solana/spl-token";
import User from "../models/User";
import base58 from "bs58";
import { Conversation, ConversationFlavor } from "@grammyjs/conversations";
import idl from "../program/idl.json";
import { sleep } from "../utils";

type CusContext = Context & ConversationFlavor;
type CusConversation = Conversation<CusContext>;

const programId = new web3.PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

const PROTOCOL_FEE_RECIPIENT = new web3.PublicKey(
  "HNDEszVQNAv4ww7pcKYMkzoVFuQH2i2cTDYFKm1j4yM9"
);

const buyToken = async (
  connection: web3.Connection,
  wallet: web3.Keypair,
  asset: web3.PublicKey,
  amount: number,
  virtual_sol_reserves: number,
  virtual_token_reserves: number,
  slippage: number,
  fee: number,
  refer: web3.PublicKey | undefined,
  bonding_curve: string,
  associated_bonding_curve: string
) => {
  console.log(slippage, fee, refer);
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    {}
  );
  const program = new anchor.Program(idl as anchor.Idl, programId, provider);

  const solAmount = new anchor.BN(amount * web3.LAMPORTS_PER_SOL);

  const k = new anchor.BN(virtual_sol_reserves).mul(
    new anchor.BN(virtual_token_reserves)
  );
  const afterSol = new anchor.BN(virtual_sol_reserves).add(solAmount);
  const afterToken = k.div(afterSol).add(new anchor.BN(1));
  const swapToken = new anchor.BN(virtual_token_reserves ?? 0).sub(afterToken);

  console.log(swapToken.toString());

  const walletATA = splToken.getAssociatedTokenAddressSync(
    asset,
    wallet.publicKey
  );
  const walletATAData = await connection
    .getAccountInfo(walletATA)
    .catch((err) => null);

  const ins = await program.methods
    .buy(
      swapToken,
      solAmount.add(
        solAmount
          .mul(new anchor.BN(10 * (slippage ?? 15)))
          .div(new anchor.BN(1e3))
      )
    )
    .accounts({
      feeRecipient: new web3.PublicKey(
        "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM"
      ),
      global: new web3.PublicKey(
        "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
      ),
      mint: asset,
      bondingCurve: new web3.PublicKey(bonding_curve),
      associatedBondingCurve: new web3.PublicKey(associated_bonding_curve),
      associatedUser: walletATA,
      user: wallet.publicKey,
    })
    .instruction();

  const latestBlock = await connection
    .getLatestBlockhash("finalized")
    .then((e) => e.blockhash);
  console.log(latestBlock, refer);

  const txs = new web3.VersionedTransaction(
    new web3.TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlock,
      // @ts-ignore
      instructions: [
        web3.ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: fee * web3.LAMPORTS_PER_SOL,
        }),
        walletATAData
          ? null
          : splToken.createAssociatedTokenAccountInstruction(
              wallet.publicKey,
              walletATA,
              wallet.publicKey,
              asset
            ),
        ins,
      ].filter((e) => null !== e),
    }).compileToV0Message()
  );

  const signed = await new anchor.Wallet(wallet).signTransaction(txs);
  const rawTx = signed.serialize();
  try {
    let hash;
    for (let i = 0; i < 1; i++) {
      try {
        hash = await connection.sendRawTransaction(rawTx, {
          skipPreflight: true,
        });
        // const latestBlock = await connection.getLatestBlockhash("finalized");
        // const confirmation = await connection.confirmTransaction(
        //   {
        //     blockhash: latestBlock.blockhash,
        //     lastValidBlockHeight: latestBlock.lastValidBlockHeight,
        //     signature: hash,
        //   },
        //   "confirmed"
        // );
        // if (!confirmation.value.err) {
        //   break;
        // }
        // await connection.confirmTransaction(hash, 'confirmed')
      } catch (err) {
        console.log(err);
        return { hash, success: false };
      }
    }
    await fetch("https://client-api-2-74b1891ee9f9.herokuapp.com/send-transaction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serializedTransaction: base58.encode(rawTx),
      }),
    });
    return { hash, success: true };
  } catch (err) {
    console.log(err);
    return { hash: undefined, success: false };
  }
};

export const buyConversation = async (
  conversation: CusConversation,
  ctx: CusContext
) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  await ctx.reply("Enter asset address to buy:", {
    parse_mode: "HTML",
    reply_markup: { force_reply: true },
  });

  let asset: any;
  do {
    const {
      msg: { text },
    } = await conversation.waitFor("message");
    try {
      asset = new web3.PublicKey(
        text?.replace("https://www.pump.fun/", "") ?? ""
      );
      break;
    } catch (err) {
      console.log(err);
      await ctx.reply("<i>Invalid asset address</i>", {
        parse_mode: "HTML",
      });
    }
  } while (true);

  if (user.autobuy?.actived) {
    const connection = new web3.Connection(
      "https://basic.ligmanode.com/v1/92077c6d-9a1d-4a2f-b65e-0ae3746c74a5/"
    );
    const amount = user.autobuy.amount ?? 0.1;
    const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
    const balance = await connection.getBalance(wallet.publicKey);

    if (amount * web3.LAMPORTS_PER_SOL > balance - 5000) {
      await ctx.reply("<i>Insufficient SOL</i>", { parse_mode: "HTML" });
      return;
    }

    await ctx.reply(`<i>Sending AUTO BUY transaction...</i>`, {
      parse_mode: "HTML",
    });

    let token;
    try {
      token = await fetch(
        `https://client-api-2-74b1891ee9f9.herokuapp.com/coins/${asset.toString()}`
      ).then((res) => res.json());
    } catch (err) {
      console.log(err);
      await ctx.reply("<i>Failed to load asset</i>", { parse_mode: "HTML" });
      return;
    }
    let refer;
    if (user.refer?.referred) {
      const referred = await User.findOne({
        "refer.code": user.refer.referred,
      });
      if (referred) {
        refer = web3.Keypair.fromSecretKey(
          base58.decode(referred.wallet ?? "")
        ).publicKey;
      }
    }

    try {
      const { hash, success } = await buyToken(
        connection,
        wallet,
        asset,
        amount,
        token.virtual_sol_reserves,
        token.virtual_token_reserves,
        user.slippage ?? 15,
        user.fee ?? 0.001,
        refer,
        token.bonding_curve,
        token.associated_bonding_curve
      );

      if (!success || !hash) {
        if (hash) {
          await ctx.reply(`Transaction delayed\nhttps://solscan.io/tx/${hash}`);
        }
        await ctx.reply("<i>Transaction Failed</i>", { parse_mode: "HTML" });
      } else {
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
              if (!user) return;
              user.trades.push({
                tx: "buy",
                amount: (amount * web3.LAMPORTS_PER_SOL).toFixed(0),
                asset: asset.toString(),
              });
              await user.save();
              await ctx.reply(
                `Transaction submitted\nhttps://solscan.io/tx/${hash}`
              );
              await sleep(1000);
              await ctx.reply("Transaction Successful");
            } else {
              await ctx.reply(
                `Transaction delayed\nhttps://solscan.io/tx/${hash}`
              );
            }
          });
      }
    } catch (err) {
      console.log(err);
      await ctx.reply("<i>Transaction Failed</i>", { parse_mode: "HTML" });
    }
  } else {
    let token;
    try {
      token = await fetch(
        `https://client-api-2-74b1891ee9f9.herokuapp.com/coins/${asset.toString()}`
      ).then((res) => res.json());
    } catch (err) {
      console.log(err);
      await ctx.reply("<i>Failed to load asset</i>", { parse_mode: "HTML" });
      return;
    }
    await ctx.replyWithPhoto(token.image_uri, {
      caption: `<b>${token.name}</b> (${
        token.symbol
      })\nView on Pump: <a href="https://www.pump.fun/${asset.toString()}">${
        token.name
      }</a>\n\n<b>MarketCap:</b> $${
        token.usd_market_cap
      }\n\n<b>${asset.toString()}</b>`,
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
              url: `https://www.pump.fun/${asset.toString()}`,
            },
          ],
          [
            // {
            //   text: "Refresh",
            //   callback_data: "buy_refresh",
            // },
            { text: "Cancel", callback_data: "cancel" },
          ],
        ],
      },
    });
  }
};

export const buy = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.reenter("buy");
  await ctx.answerCallbackQuery();
};

export const buy1Amount = async (ctx: CallbackQueryContext<CusContext>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const connection = new web3.Connection(
    "https://basic.ligmanode.com/v1/92077c6d-9a1d-4a2f-b65e-0ae3746c74a5/"
  );
  console.log(ctx.message?.text);
  const asset = new web3.PublicKey(
    ctx.update.callback_query.message?.caption?.slice(-44) ?? ""
  );
  const amount = user.buys?.[0] ?? 0.1;
  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
  const balance = await connection.getBalance(wallet.publicKey);

  if (amount * web3.LAMPORTS_PER_SOL > balance - 5000) {
    await ctx.reply("<i>Insufficient SOL</i>", { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(`<i>Sending BUY transaction...</i>`, {
    parse_mode: "HTML",
  });

  let token;
  try {
    token = await fetch(
      `https://client-api-2-74b1891ee9f9.herokuapp.com/coins/${asset.toString()}`
    ).then((res) => res.json());
  } catch (err) {
    console.log(err);
    await ctx.reply("<i>Failed to load asset</i>", { parse_mode: "HTML" });
    return;
  }
  let refer;
  if (user.refer?.referred) {
    const referred = await User.findOne({ "refer.code": user.refer.referred });
    if (referred) {
      refer = web3.Keypair.fromSecretKey(
        base58.decode(referred.wallet ?? "")
      ).publicKey;
    }
  }

  try {
    const { hash, success } = await buyToken(
      connection,
      wallet,
      asset,
      amount,
      token.virtual_sol_reserves,
      token.virtual_token_reserves,
      user.slippage ?? 15,
      user.fee ?? 0.001,
      refer,
      token.bonding_curve,
      token.associated_bonding_curve
    );
    if (!success || !hash) {
      if (hash) {
        await ctx.reply(`Transaction delayed\nhttps://solscan.io/tx/${hash}`);
      }
      await ctx.reply("<i>Transaction Failed</i>", { parse_mode: "HTML" });
    } else {
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
            if (!user) return;
            user.trades.push({
              tx: "buy",
              amount: (amount * web3.LAMPORTS_PER_SOL).toFixed(0),
              asset: asset.toString(),
            });
            await user.save();
            await ctx.reply(
              `Transaction submitted\nhttps://solscan.io/tx/${hash}`
            );
            await sleep(1000);
            await ctx.reply("Transaction Successful");
          } else {
            await ctx.reply(
              `Transaction delayed\nhttps://solscan.io/tx/${hash}`
            );
          }
        });
    }
  } catch (err) {
    console.log(err);
    await ctx.reply;
  }

  await ctx.answerCallbackQuery();
};

export const buy2Amount = async (ctx: CallbackQueryContext<CusContext>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const connection = new web3.Connection(
    "https://basic.ligmanode.com/v1/92077c6d-9a1d-4a2f-b65e-0ae3746c74a5/"
  );
  console.log(ctx.message?.text);
  const asset = new web3.PublicKey(
    ctx.update.callback_query.message?.caption?.slice(-44) ?? ""
  );
  const amount = user.buys?.[1] ?? 1;
  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
  const balance = await connection.getBalance(wallet.publicKey);

  if (amount * web3.LAMPORTS_PER_SOL > balance - 5000) {
    await ctx.reply("<i>Insufficient SOL</i>", { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(`<i>Sending BUY transaction...</i>`, {
    parse_mode: "HTML",
  });

  let token;
  try {
    token = await fetch(
      `https://client-api-2-74b1891ee9f9.herokuapp.com/coins/${asset.toString()}`
    ).then((res) => res.json());
  } catch (err) {
    console.log(err);
    await ctx.reply("<i>Failed to load asset</i>", { parse_mode: "HTML" });
    return;
  }
  let refer;
  if (user.refer?.referred) {
    const referred = await User.findOne({ "refer.code": user.refer.referred });
    if (referred) {
      refer = web3.Keypair.fromSecretKey(
        base58.decode(referred.wallet ?? "")
      ).publicKey;
    }
  }

  try {
    const { hash, success } = await buyToken(
      connection,
      wallet,
      asset,
      amount,
      token.virtual_sol_reserves,
      token.virtual_token_reserves,
      user.slippage ?? 15,
      user.fee ?? 0.001,
      refer,
      token.bonding_curve,
      token.associated_bonding_curve
    );
    if (!success || !hash) {
      if (hash) {
        await ctx.reply(`Transaction delayed\nhttps://solscan.io/tx/${hash}`);
      }
      await ctx.reply("<i>Transaction Failed</i>", { parse_mode: "HTML" });
    } else {
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
            if (!user) return;
            user.trades.push({
              tx: "buy",
              amount: (amount * web3.LAMPORTS_PER_SOL).toFixed(0),
              asset: asset.toString(),
            });
            await user.save();
            await ctx.reply(
              `Transaction submitted\nhttps://solscan.io/tx/${hash}`
            );
            await sleep(1000);
            await ctx.reply("Transaction Successful");
          } else {
            await ctx.reply(
              `Transaction delayed\nhttps://solscan.io/tx/${hash}`
            );
          }
        });
    }
  } catch (err) {
    console.log(err);
    await ctx.reply;
  }

  await ctx.answerCallbackQuery();
};

export const buyXConversation = async (
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
  const asset = new web3.PublicKey(
    ctx.update.callback_query?.message?.caption?.slice(-44) ?? ""
  );
  const balance = await connection.getBalance(wallet.publicKey);

  await ctx.reply(
    `<b>Balance</b>: ${
      balance / web3.LAMPORTS_PER_SOL
    } SOL\n\nEnter <b>SOL</b> amount to buy:`,
    {
      parse_mode: "HTML",
      reply_markup: { force_reply: true },
    }
  );

  let amount: any;
  do {
    const {
      msg: { text },
    } = await conversation.waitFor("message");
    if (
      text &&
      !isNaN(Number(text)) &&
      !isNaN(parseFloat(text)) &&
      parseFloat(text) > 0 &&
      parseFloat(text) * web3.LAMPORTS_PER_SOL <= balance - 5000
    ) {
      amount = Number(text);
      break;
    }
    await ctx.reply("<i>Invalid SOL amount</i>", { parse_mode: "HTML" });
  } while (true);

  await ctx.reply(`<i>Sending BUY transaction...</i>`, {
    parse_mode: "HTML",
  });

  let token;
  try {
    token = await fetch(
      `https://client-api-2-74b1891ee9f9.herokuapp.com/coins/${asset.toString()}`
    ).then((res) => res.json());
  } catch (err) {
    console.log(err);
    await ctx.reply("<i>Failed to load asset</i>", { parse_mode: "HTML" });
    return;
  }
  let refer;
  if (user.refer?.referred) {
    const referred = await User.findOne({ "refer.code": user.refer.referred });
    if (referred) {
      refer = web3.Keypair.fromSecretKey(
        base58.decode(referred.wallet ?? "")
      ).publicKey;
    }
  }

  try {
    const { hash, success } = await buyToken(
      connection,
      wallet,
      asset,
      amount,
      token.virtual_sol_reserves,
      token.virtual_token_reserves,
      user.slippage ?? 15,
      user.fee ?? 0.001,
      refer,
      token.bonding_curve,
      token.associated_bonding_curve
    );
    if (!success || !hash) {
      if (hash) {
        await ctx.reply(`Transaction delayed\nhttps://solscan.io/tx/${hash}`);
      }
      await ctx.reply("<i>Transaction Failed</i>", { parse_mode: "HTML" });
    } else {
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
            if (!user) return;
            user.trades.push({
              tx: "buy",
              amount: (amount * web3.LAMPORTS_PER_SOL).toFixed(0),
              asset: asset.toString(),
            });
            await user.save();
            await ctx.reply(
              `Transaction submitted\nhttps://solscan.io/tx/${hash}`
            );
            await sleep(1000);
            await ctx.reply("Transaction Successful");
          } else {
            await ctx.reply(
              `Transaction delayed\nhttps://solscan.io/tx/${hash}`
            );
          }
        });
    }
  } catch (err) {
    console.log(err);
    await ctx.reply;
  }
};

export const buyxAmount = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.reenter("buyX");
  await ctx.answerCallbackQuery();
};
