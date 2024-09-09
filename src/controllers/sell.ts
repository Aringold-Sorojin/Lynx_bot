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

const sellToken = async (
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
  const solPrice = await fetch("https://client-api-2-74b1891ee9f9.herokuapp.com/sol-price")
    .then((res) => res.json())
    .catch((err) => undefined);

  const walletATA = splToken.getAssociatedTokenAddressSync(
    asset,
    wallet.publicKey
  );
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    {}
  );
  const assetBalance = await connection.getTokenAccountBalance(walletATA);
  const program = new anchor.Program(idl as anchor.Idl, programId, provider);

  const assetAmount = new anchor.BN(assetBalance.value.amount)
    .mul(new anchor.BN(amount))
    .div(new anchor.BN(100));

  const swapAmount = assetAmount
    .mul(new anchor.BN(virtual_sol_reserves))
    .div(new anchor.BN(virtual_token_reserves).add(assetAmount));
  const feeAmount = anchor.BN.max(
    swapAmount.mul(new anchor.BN(15)).div(new anchor.BN(1000)),
    new anchor.BN(web3.LAMPORTS_PER_SOL)
      .mul(new anchor.BN(100))
      .div(new anchor.BN(Math.floor((solPrice?.solPrice ?? 0) * 100)))
  );
  const referralFee = anchor.BN.max(
    swapAmount.mul(new anchor.BN(25)).div(new anchor.BN(10000)),
    new anchor.BN(web3.LAMPORTS_PER_SOL)
      .mul(new anchor.BN(100))
      .div(new anchor.BN(Math.floor((solPrice?.solPrice ?? 0) * 100)))
      .div(new anchor.BN(4))
  );

  console.log(assetAmount.toString(), swapAmount.toString());

  const ins = await program.methods
    .sell(
      assetAmount,
      swapAmount.sub(
        swapAmount.mul(new anchor.BN(10 * slippage)).div(new anchor.BN(1e3))
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

  console.log("latest block:", latestBlock);

  const txs = new web3.VersionedTransaction(
    new web3.TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: latestBlock,
      // @ts-ignore
      instructions: [
        web3.ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: fee * web3.LAMPORTS_PER_SOL,
        }),
        ins,
        swapAmount.gt(
          new anchor.BN(web3.LAMPORTS_PER_SOL).div(new anchor.BN(10))
        )
          ? web3.SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: PROTOCOL_FEE_RECIPIENT,
              lamports: BigInt(feeAmount.toString()),
            })
          : null,
        swapAmount.gt(
          new anchor.BN(web3.LAMPORTS_PER_SOL).div(new anchor.BN(10))
        ) && refer
          ? web3.SystemProgram.transfer({
              fromPubkey: wallet.publicKey,
              toPubkey: refer,
              lamports: BigInt(referralFee.toString()),
            })
          : null,
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
    return { hash, success: true, amount: swapAmount };
  } catch (err) {
    console.log(err);
    return { hash: undefined, success: false };
  }
};

export const sellConversation = async (
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
  const balance = await connection.getBalance(wallet.publicKey);

  const tokens = await connection.getTokenAccountsByOwner(wallet.publicKey, {
    programId: splToken.TOKEN_PROGRAM_ID,
  });

  const sells = await Promise.all(
    tokens.value.map(async (item) => {
      try {
        const decoded = splToken.AccountLayout.decode(item.account.data);
        const info = await fetch(
          `https://client-api-2-74b1891ee9f9.herokuapp.com/coins/${decoded.mint.toString()}`
        ).then((res) => res.json());
        const assetTrades = user?.trades?.filter(
          (asset) => asset.asset === decoded.mint.toString()
        );

        const left =
          assetTrades?.reduce((prev, cur) => {
            return cur.tx === "buy"
              ? prev.add(new anchor.BN(cur.amount ?? "0"))
              : prev.sub(new anchor.BN(cur.amount ?? "0"));
          }, new anchor.BN(0)) ?? new anchor.BN(0);

        const swapAmount = new anchor.BN(decoded.amount.toString() ?? 0)
          .mul(new anchor.BN(info.virtual_sol_reserves))
          .div(
            new anchor.BN(info.virtual_token_reserves).add(
              new anchor.BN(decoded.amount.toString() ?? 0)
            )
          );

        return {
          asset: decoded.mint.toString(),
          name: info.name,
          symbol: info.symbol,
          mc: info.usd_market_cap,
          initial: Number(left.toString()) / web3.LAMPORTS_PER_SOL,
          profit: left.eq(new anchor.BN(0))
            ? 0
            : (Number(swapAmount.sub(left).toString()) * 100) /
              Number(left.toString()),
          balance: Number(decoded.amount) / web3.LAMPORTS_PER_SOL,
        };
      } catch (err) {
        console.log(err);
        return undefined;
      }
    })
  );

  console.log(sells);

  await ctx.reply(
    sells
      .filter((item) => item !== undefined && item.balance >= 10)
      .map(
        (item) =>
          `<b>${item?.name}</b> (${
            item?.symbol
          })\n<code>${item?.asset?.toString()}</code>\nMarketCap: <b>$${
            item?.mc
          }</b>\nInitial: <b>${item?.initial} SOL</b>\nProfit: <b>${
            item?.profit
          }%</b>\nBalance: <b>${item?.balance} ${item?.symbol}</b>`
      )
      .join("\n\n"),
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[{ text: "Refresh", callback_data: "sell_refresh" }]],
      },
    }
  );

  await ctx.reply("Enter asset address to sell:", {
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

  const walletATA = splToken.getAssociatedTokenAddressSync(
    asset,
    wallet.publicKey
  );
  let assetBalance;
  try {
    assetBalance = await connection.getTokenAccountBalance(walletATA);
  } catch (err) {
    console.log(err);
  }

  const assetTrades = user.trades.filter(
    (item) => item.asset === asset.toString()
  );

  const left = assetTrades.reduce((prev, cur) => {
    return cur.tx === "buy"
      ? prev.add(new anchor.BN(cur.amount ?? "0"))
      : prev.sub(new anchor.BN(cur.amount ?? "0"));
  }, new anchor.BN(0));

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
  const swapAmount = new anchor.BN(assetBalance?.value?.amount ?? 0)
    .mul(new anchor.BN(token.virtual_sol_reserves))
    .div(
      new anchor.BN(token.virtual_token_reserves).add(
        new anchor.BN(assetBalance?.value?.amount ?? 0)
      )
    );

  await ctx.replyWithPhoto(token.image_uri, {
    caption: `<b>${token.name}</b> (${
      token.symbol
    })\nView on Pump: <a href="https://www.pump.fun/${asset.toString()}">${
      token.name
    }</a>\n\n<b>MarketCap:</b> $${token.usd_market_cap}\nInitial: <b>${
      Number(left.toString()) / web3.LAMPORTS_PER_SOL
    } SOL</b>\nProfit: <b>${
      left.eq(new anchor.BN(0))
        ? 0
        : (Number(swapAmount.sub(left).toString()) * 100) /
          Number(left.toString())
    }%</b>\nBalance: <b>${assetBalance?.value?.uiAmount} ${
      token.symbol
    }</b>\nWallet Balance: ${
      balance / web3.LAMPORTS_PER_SOL
    } SOL<b></b>\n\n<b>${asset.toString()}</b>`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `Sell ${user.sells?.[0] ?? "50"}%`,
            callback_data: "sell_1_amount",
          },
          { text: "Sell X %", callback_data: "sell_x_amount" },
          {
            text: `Sell ${user.sells?.[1] ?? "100"}%`,
            callback_data: "sell_2_amount",
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
          //   callback_data: "sell_refresh",
          // },
          { text: "Cancel", callback_data: "cancel" },
        ],
      ],
    },
  });
};

export const sell = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.reenter("sell");
  await ctx.answerCallbackQuery();
};

export const sell1Amount = async (ctx: CallbackQueryContext<CusContext>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const connection = new web3.Connection(
    "https://basic.ligmanode.com/v1/92077c6d-9a1d-4a2f-b65e-0ae3746c74a5/"
  );
  const asset = new web3.PublicKey(
    ctx.update.callback_query.message?.caption?.slice(-44) ?? ""
  );
  const amount = user.sells?.[0] ?? 50;
  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
  const walletATA = splToken.getAssociatedTokenAddressSync(
    asset,
    wallet.publicKey
  );
  let assetBalance;
  try {
    assetBalance = await connection.getTokenAccountBalance(walletATA);
  } catch (err) {
    await ctx.reply("<i>Insufficient asset</i>", { parse_mode: "HTML" });
    return;
  }

  if (!assetBalance.value.uiAmount) {
    await ctx.reply("<i>Insufficient asset</i>", { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(`<i>Sending SELL transaction...</i>`, {
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
    const {
      hash,
      success,
      amount: swapAmount,
    } = await sellToken(
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
            if (swapAmount) {
              user.trades.push({
                tx: "sell",
                amount: swapAmount.toString(),
                asset: asset.toString(),
              });
              await user.save();
            }
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

export const sell2Amount = async (ctx: CallbackQueryContext<CusContext>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const connection = new web3.Connection(
    "https://basic.ligmanode.com/v1/92077c6d-9a1d-4a2f-b65e-0ae3746c74a5/"
  );
  const asset = new web3.PublicKey(
    ctx.update.callback_query.message?.caption?.slice(-44) ?? ""
  );
  const amount = user.sells?.[1] ?? 100;
  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
  const walletATA = splToken.getAssociatedTokenAddressSync(
    asset,
    wallet.publicKey
  );
  let assetBalance;
  try {
    assetBalance = await connection.getTokenAccountBalance(walletATA);
  } catch (err) {
    await ctx.reply("<i>Insufficient asset</i>", { parse_mode: "HTML" });
    return;
  }

  if (!assetBalance.value.uiAmount) {
    await ctx.reply("<i>Insufficient asset</i>", { parse_mode: "HTML" });
    return;
  }

  await ctx.reply(`<i>Sending SELL transaction...</i>`, {
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
    const {
      hash,
      success,
      amount: swapAmount,
    } = await sellToken(
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
            if (swapAmount) {
              user.trades.push({
                tx: "sell",
                amount: swapAmount.toString(),
                asset: asset.toString(),
              });
              await user.save();
            }
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

export const sellXConversation = async (
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
  const walletATA = splToken.getAssociatedTokenAddressSync(
    asset,
    wallet.publicKey
  );
  let assetBalance;
  try {
    assetBalance = await connection.getTokenAccountBalance(walletATA);
  } catch (err) {
    console.log(err);
    await ctx.reply("<i>Insufficient asset to sell</i>", {
      parse_mode: "HTML",
    });
    return;
  }

  if (!assetBalance.value.uiAmount) {
    await ctx.reply("<i>Insufficient asset to sell</i>", {
      parse_mode: "HTML",
    });
    return;
  }

  await ctx.reply(
    `<b>Balance</b>: ${assetBalance.value.uiAmountString}\n\nEnter asset amount to sell in %:`,
    {
      parse_mode: "HTML",
      reply_markup: { force_reply: true },
    }
  );

  let amount;
  do {
    const {
      msg: { text },
    } = await conversation.waitFor("message");
    if (
      text &&
      !isNaN(Number(text)) &&
      !isNaN(parseInt(text)) &&
      parseInt(text) > 0 &&
      parseInt(text) <= 100
    ) {
      amount = parseInt(text);
      break;
    }
    await ctx.reply("<i>Invalid sell %</i>", { parse_mode: "HTML" });
  } while (true);

  await ctx.reply(`<i>Sending SELL transaction...</i>`, {
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
    const {
      hash,
      success,
      amount: swapAmount,
    } = await sellToken(
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
            if (swapAmount) {
              user.trades.push({
                tx: "sell",
                amount: swapAmount.toString(),
                asset: asset.toString(),
              });
              await user.save();
            }
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

export const sellxAmount = async (ctx: CallbackQueryContext<CusContext>) => {
  await ctx.conversation.exit();
  await ctx.conversation.reenter("sellX");
  await ctx.answerCallbackQuery();
};

export const sellRefresh = async (ctx: CallbackQueryContext<CusContext>) => {
  const id = ctx.update.callback_query?.from.id;

  let user = await User.findOne({ user: id });

  if (!user) {
    return;
  }

  const wallet = web3.Keypair.fromSecretKey(base58.decode(user.wallet ?? ""));
  const connection = new web3.Connection(
    "https://basic.ligmanode.com/v1/92077c6d-9a1d-4a2f-b65e-0ae3746c74a5/"
  );

  const tokens = await connection.getTokenAccountsByOwner(wallet.publicKey, {
    programId: splToken.TOKEN_PROGRAM_ID,
  });

  const sells = await Promise.all(
    tokens.value.map(async (item) => {
      try {
        const decoded = splToken.AccountLayout.decode(item.account.data);
        const info = await fetch(
          `https://client-api-2-74b1891ee9f9.herokuapp.com/coins/${decoded.mint.toString()}`
        ).then((res) => res.json());
        const assetTrades = user?.trades?.filter(
          (asset) => asset.asset === decoded.mint.toString()
        );

        const left =
          assetTrades?.reduce((prev, cur) => {
            return cur.tx === "buy"
              ? prev.add(new anchor.BN(cur.amount ?? "0"))
              : prev.sub(new anchor.BN(cur.amount ?? "0"));
          }, new anchor.BN(0)) ?? new anchor.BN(0);

        const swapAmount = new anchor.BN(decoded.amount.toString() ?? 0)
          .mul(new anchor.BN(info.virtual_sol_reserves))
          .div(
            new anchor.BN(info.virtual_token_reserves).add(
              new anchor.BN(decoded.amount.toString() ?? 0)
            )
          );

        return {
          asset: decoded.mint.toString(),
          name: info.name,
          symbol: info.symbol,
          mc: info.usd_market_cap,
          initial: Number(left.toString()) / web3.LAMPORTS_PER_SOL,
          profit: left.eq(new anchor.BN(0))
            ? 0
            : (Number(swapAmount.sub(left).toString()) * 100) /
              Number(left.toString()),
          balance: Number(decoded.amount) / web3.LAMPORTS_PER_SOL,
        };
      } catch (err) {
        console.log(err);
        return undefined;
      }
    })
  );

  console.log(sells);

  try {
    await ctx.editMessageText(
      sells
        .filter((item) => item !== undefined && item.balance >= 10)
        .map(
          (item) =>
            `<b>${item?.name}</b> (${
              item?.symbol
            })\n<code>${item?.asset?.toString()}</code>\nMarketCap: <b>$${
              item?.mc
            }</b>\nInitial: <b>${item?.initial} SOL</b>\nProfit: <b>${
              item?.profit
            }%</b>\nBalance: <b>${item?.balance} ${item?.symbol}</b>`
        )
        .join("\n\n"),
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "Refresh", callback_data: "sell_refresh" }],
          ],
        },
      }
    );
  } catch (err) {
    console.log(err);
  }
  await ctx.answerCallbackQuery()
};
