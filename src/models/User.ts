import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  user: {
    type: Number,
    required: true,
    unique: true,
  },
  wallet: {
    type: String,
  },
  slippage: {
    type: Number,
    default: 15,
  },
  fee: {
    type: Number,
    default: 0.001,
  },
  autobuy: {
    actived: {
      type: Boolean,
    },
    amount: {
      type: Number,
    },
  },
  refer: {
    code: {
      type: String,
    },
    counts: {
      type: Number,
    },
    referred: {
      type: String,
    },
  },
  trades: [
    {
      asset: String,
      tx: String,
      amount: String,
    },
  ],
  latest: {
    type: Boolean,
  },
  buys: [{ type: Number }],
  sells: [{ type: Number }],
});

const User = mongoose.model("user", UserSchema);
export default User;
