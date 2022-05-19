import { AzureFunction, Context } from "@azure/functions";
import { LCDClient, Wallet, Coin, Coins, MnemonicKey, MsgExecuteContract, MsgSend } from '@terra-money/terra.js';
import Axios from "axios";
import { Telegraf } from "telegraf";
const { MongoClient } = require('mongodb');

import { Logger } from "../src/Logger";
import { TerraService } from "../src/TerraService";
import { TerraswapService } from "../src/TerraswapService";

const timerTrigger: AzureFunction = async function (context: Context, myTimer: any): Promise<void> {

    require('dotenv').config();

    let globals: any = {
        terra: new LCDClient({
            URL: 'https://lcd.terra.dev',
            chainID: 'columbus-5',
        }),
        axios: Axios.create({}),
        max_spread: "0.005",
        telegraf: new Telegraf(process.env.TELEGRAM_TOKEN_BOT3),
        mk: process.env.MK_BOT4,
        wallet: null,
        oracle: null,
        print_summary: Boolean
    };

    var timeStamp = new Date();
    var minutes = timeStamp.getMinutes();
    var seconds = timeStamp.getSeconds();
    if (minutes == 0  && seconds < 5) {
        globals.print_summary = true;
    } else {
        globals.print_summary = false;
    }
    // globals.print_summary = false;

    var logger = new Logger(context);
    var terraService = new TerraService(globals, logger);
    var terraswapService = new TerraswapService(globals, logger);

    globals.wallet = terraService.InitWallet(globals.mk);
    let coins = await terraService.GetWalletCoinBalance(globals.wallet);

    // let balanceUst: Coin = coins.get("uusd");
    // let balanceUstNumber: number = balanceUst != null ? Number(balanceUst.toAmino().amount) / 1000000 : 0;

    let balanceLunaCoin: Coin = coins.get("uluna");
    let balanceLuna = balanceLunaCoin?.toAmino().amount;
    let balanceLunaNumber: number = balanceLuna != null ? Number(balanceLuna) / 1000000 : 0;

    if (balanceLunaNumber > 0) {
        let result = await terraswapService.SimulateAndSwap(globals.wallet, balanceLuna, "uluna", process.env.ANCHOR_COLLATERAL_TOKEN_CLUNA);
        if (globals.print_summary) {

            let message = `Bot4: Highest simulated rate for [${balanceLunaNumber}] LUNA is [${result.rateInvert}][${result.rate}][${result.FromPool}]`;
            logger.Log(message);
            await globals.telegraf.telegram.sendMessage(process.env.TELEGRAM_CHANEL_ID, message);
        }
    }

    let balanceCLuna = await terraService.GetWalletTokenBalance(globals.wallet, process.env.ANCHOR_COLLATERAL_TOKEN_CLUNA);
    let balanceCLunaNumber: number = balanceCLuna != null ? Number(balanceCLuna) / 1000000 : 0;

    if (balanceCLunaNumber > 0) {
        let result = await terraswapService.SimulateAndSwap(globals.wallet, balanceCLuna, process.env.ANCHOR_COLLATERAL_TOKEN_CLUNA, "uluna");
        if (globals.print_summary) {

            let message = `Bot4: Highest simulated rate for [${balanceCLunaNumber}] cLuna is [${result.rate}][${result.rateInvert}][${result.FromPool}]`;
            logger.Log(message);
            await globals.telegraf.telegram.sendMessage(process.env.TELEGRAM_CHANEL_ID, message);
        }
    }
};

export default timerTrigger;
