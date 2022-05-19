import { LCDClient, Wallet, Coin, Coins, MnemonicKey, MsgExecuteContract, MsgSend, isTxError } from '@terra-money/terra.js';
import { Logger } from "../src/Logger";

require('dotenv').config();

export class TerraService {
    constructor(private globals: any, private logger: Logger) { }

    InitWallet(mnemonickey: string) {
        this.logger.Debug("InitWallet - Begin");
        try {
            const mk = new MnemonicKey({
                mnemonic: mnemonickey
            });

            return this.globals.terra.wallet(mk);
        }
        catch (err) {
            this.logger.Error(err);
        }
        finally {
            this.logger.Debug("InitWallet - End");
        }
    }

    async ExecuteContract(wallet: Wallet, msgs: MsgExecuteContract[]) {
        try {
            let tx = await wallet.createAndSignTx({
                msgs: msgs,
                gasPrices: { uusd: 0.15 },
                gasAdjustment: 1.4
            });

            this.logger.Debug(tx);
            const result = await this.globals.terra.tx.broadcastSync(tx);
            this.logger.Debug(result);

            if (isTxError(result)) {
                await this.globals.telegraf.telegram.sendMessage(process.env.TELEGRAM_CHANEL_ID, `encountered an error while running the transaction: ${result.code} ${result.codespace}`);
            }

            return true;
        }
        catch (err) {
            this.logger.Error(err);
            await this.globals.telegraf.telegram.sendMessage(process.env.TELEGRAM_CHANEL_ID, err);
            return false;
        }
    }

    async GetWalletCoinBalance(wallet: Wallet) {
        try {
            this.logger.Debug("GetWalletCoinBalance - Function Begin");
            const result = await this.globals.terra.bank.balance(wallet.key.accAddress);
            const coins = result[0];

            let balanceUst = coins.get("uusd");
            let balanceUstValue = Number(balanceUst.toAmino().amount)/1000000;

            let balanceUluna = coins.get("uluna");
            let balanceUlunaValue = Number(balanceUluna?.toAmino().amount)/1000000;

            this.logger.Log(`Bot4: UST balance is ${balanceUstValue}`);
            this.logger.Log(`Bot4: LUNA balance is ${balanceUlunaValue}`);

            return coins;
        }
        catch (err) {
            this.logger.Error(err);
        }
        finally {
            this.logger.Debug("GetWalletCoinBalance - Function End");
        }
    }

    async GetWalletTokenBalance(wallet: Wallet, token: string) {
        try {
            this.logger.Debug("GetWalletTokenBalance - Function Begin");

            const contractBalance: any = await this.globals.terra.wasm.contractQuery(
                token,
                {
                    balance: { address: wallet.key.accAddress }
                });

            var balToken: string = contractBalance.balance;

            this.logger.Log("Bot4: Token balance is " + Number(balToken) / 1000000);

            return balToken;
        }
        catch (err) {
            this.logger.Error(err);
        }
        finally {
            this.logger.Debug("GetWalletTokenBalance - Function End");
        }
    }

}