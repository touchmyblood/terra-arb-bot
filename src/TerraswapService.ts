import { LCDClient, Wallet, Coin, Coins, MnemonicKey, MsgExecuteContract, MsgSend, MsgAcknowledgement } from '@terra-money/terra.js';
import Axios from "axios";
import { Telegraf } from "telegraf";
const { MongoClient } = require('mongodb');

import { Logger } from "../src/Logger";
import { TerraService } from "../src/TerraService";

require('dotenv').config();

export class TerraswapService {
    constructor(private globals: any, private logger: Logger) { }

    HigestSimulatedAmount: number;
    SuccessfulRoutesSimulated: number;
    SuggestedRoutes: number;
    FromPool: string;
    CW20Send: MsgExecuteContract;

    async GetTerraswapRoutes(amount: string, from: string, to: string) {

        try {
            const url = `https://api.terraswap.io/tx/swap?amount=${amount}&from=${from}&to=${to}&sender=-&max_spread=0&belief_price=0`;

            const axios = require('axios').default;
            const result = await axios.get(url);
            const data = await result.data;

            return data;
        } catch (err) {
            console.log(err.message);
        }
    }

    IsNative(coin: string) {
        // TODO: use treasury tax to find out if asset is native
        // https://lcd.terra.dev/treasury/tax_caps  
        // https://fcd.terra.dev/v1/txs/gas_prices

        if (coin == "uluna" || coin == "uusd") {
            return true;
        }
        return false;
    }

    async SimulateTerraSwap(wallet: Wallet, quantity: string, from: string, to: string) {
        try {
            this.logger.Debug("SimulateTerraSwap - Function Begin");

            let terraSwapRoutes: any[] = await this.GetTerraswapRoutes("1", from, to);

            this.SuggestedRoutes = terraSwapRoutes.length;

            await terraSwapRoutes.reduce(async (memo, route) => {
                await memo;

                const simulateMsg = (Array.isArray(route) ? route[0] : route)?.value as MsgExecuteContract;
                const tokenContract = simulateMsg.contract as any;
                const execute_msg = simulateMsg.execute_msg as any;
                const contractAddress = execute_msg?.send?.contract as any;
                const routeText = execute_msg?.text as string;
                let address = (this.IsNative(from)) ? tokenContract : contractAddress;

                const operations: any[] =
                    execute_msg?.execute_swap_operations?.operations ||
                    execute_msg?.send?.execute_swap_operations?.operations ||
                    execute_msg?.send?.msg?.execute_swap_operations?.operations;

                if (operations == null) {

                    try {
                        let simulationResult: any;

                        if (from == "uluna") {
                            simulationResult = await this.globals.terra.wasm.contractQuery(
                                tokenContract,
                                {
                                    "simulation": {
                                        "offer_asset": {
                                            "info": { "native_token": { "denom": from } },
                                            "amount": quantity
                                        }
                                    }
                                });

                        } else {

                            simulationResult = await this.globals.terra.wasm.contractQuery(
                                contractAddress,
                                {
                                    "simulation": {
                                        "offer_asset": {
                                            "info": {
                                                "token": {
                                                    "contract_addr": from
                                                }
                                            },
                                            "amount": quantity
                                        }
                                    }
                                });
                        }

                        const simulatedAmount = Number(simulationResult?.return_amount);
                        this.SuccessfulRoutesSimulated++;
                        if (simulatedAmount > this.HigestSimulatedAmount) {
                            this.HigestSimulatedAmount = simulatedAmount;

                            if (from == "uluna") {
                                this.CW20Send = new MsgExecuteContract(
                                    wallet.key.accAddress,
                                    tokenContract,
                                    {
                                        "swap": {
                                            "max_spread": this.globals.max_spread,
                                            "offer_asset": {
                                                "info": {
                                                    "native_token": {
                                                        "denom": "uluna"
                                                    }
                                                },
                                                "amount": quantity
                                            },
                                            "belief_price": (this.HigestSimulatedAmount / 1000000).toString()
                                        }
                                    }, { "uluna": quantity });
                            } else {

                                const msg =
                                    `{"swap":{"max_spread":"${this.globals.max_spread}","belief_price": "${(this.HigestSimulatedAmount / 1000000).toString()}"}}`;

                                let b64Msg = btoa(msg);

                                this.CW20Send = new MsgExecuteContract(
                                    wallet.key.accAddress,
                                    tokenContract,
                                    {
                                        "send": {
                                            "contract": contractAddress,
                                            "amount": quantity,
                                            "msg": b64Msg
                                        }
                                    }
                                );
                            }

                            this.FromPool = "Terraswap";
                        }
                    }
                    catch (err) {
                        this.logger.Error("Contract Address is :" + contractAddress);
                        this.logger.Error(err);
                    }

                } else {

                    try {

                        const simulationResult = await this.globals.terra.wasm.contractQuery(
                            address,
                            {
                                "simulate_swap_operations": {
                                    "offer_amount": quantity,
                                    "operations": operations,
                                }
                            });

                        const simulatedAmount = Number(simulationResult?.amount);
                        this.SuccessfulRoutesSimulated++;
                        if (simulatedAmount > this.HigestSimulatedAmount) {
                            this.HigestSimulatedAmount = simulatedAmount;
                            const msg =
                                `{"execute_swap_operations":{"operations":${JSON.stringify(operations)},"minimum_receive": "${simulatedAmount}"}}`;

                            let b64Msg = btoa(msg);

                            this.CW20Send = new MsgExecuteContract(
                                wallet.key.accAddress,
                                tokenContract,
                                {
                                    "send": {
                                        "contract": address,
                                        "amount": quantity,
                                        "msg": b64Msg
                                    }
                                }
                            );

                            this.FromPool = "Terraswap";
                        }
                    }
                    catch (err) {
                        this.logger.Error("tokenContract Address is :" + tokenContract);
                        this.logger.Error(err);
                    }
                }
            }, undefined);
        }
        catch (err) {
            this.logger.Error(err);
        }
        finally {
            this.logger.Debug("SimulateTerraSwap - Function End");
        }
    }

    async SimulateAstroport(wallet: Wallet, quantity: string, from: string, to: string) {
        try {
            this.logger.Debug("SimulateAstroport - Function Begin");

            let contract = "terra102t6psqa45ahfd7wjskk3gcnfev32wdngkcjzd";
            this.SuggestedRoutes++;

            let simulationResult: any;

            if (this.IsNative(from)) {
                simulationResult = await this.globals.terra.wasm.contractQuery(
                    contract,
                    {
                        "simulation": {
                            "offer_asset": {
                                "info": { "native_token": { "denom": from } },
                                "amount": quantity
                            }
                        }
                    });

            } else {
                simulationResult = await this.globals.terra.wasm.contractQuery(
                    contract,
                    {
                        "simulation": {
                            "offer_asset": {
                                "info": {
                                    "token": {
                                        "contract_addr": from
                                    }
                                },
                                "amount": quantity
                            }
                        }
                    });
            }
            const simulatedAmount = Number(simulationResult?.return_amount);
            if (simulatedAmount > this.HigestSimulatedAmount) {
                this.HigestSimulatedAmount = simulatedAmount;

                if (this.IsNative(from)) {
                    this.CW20Send = new MsgExecuteContract(
                        wallet.key.accAddress,
                        contract,
                        {
                            "swap": {
                                "max_spread": this.globals.max_spread,
                                "offer_asset": {
                                    "info": {
                                        "native_token": {
                                            "denom": "uluna"
                                        }
                                    },
                                    "amount": quantity
                                },
                                "belief_price": (this.HigestSimulatedAmount / 1000000).toString()
                            }
                        }, { "uluna": quantity });
                } else {

                    const msg =
                        `{"swap":{"max_spread":"${this.globals.max_spread}","belief_price": "${(this.HigestSimulatedAmount / 1000000).toString()}"}}`;

                    let b64Msg = btoa(msg);

                    this.CW20Send = new MsgExecuteContract(
                        wallet.key.accAddress,
                        from,
                        {
                            "send": {
                                "contract": contract,
                                "amount": quantity,
                                "msg": b64Msg
                            }
                        }
                    );

                }

            }

            this.FromPool = "astroport";
            this.SuccessfulRoutesSimulated++;
        }
        catch (err) {
            this.logger.Error(err);
        }
        finally {
            this.logger.Debug("SimulateAstroport - Function End");
        }
    }

    async SimulateLoop(wallet: Wallet, quantity: string, from: string, to: string) {
        try {
            this.logger.Debug("SimulateLoop - Function Begin");

            let contract = "terra1ur6yyha884t5rhpf6was9xlr7xpcq40aw2r5jx";
            let loopFactory = "terra1enclyxhkuhqgn38grejum9fu0m3g4ztpmj7a22";

            this.SuggestedRoutes++;

            let simulationResult: any;

            if (this.IsNative(from)) {
                simulationResult = await this.globals.terra.wasm.contractQuery(
                    contract,
                    {
                        "simulation": {
                            "offer_asset": {
                                "info": { "native_token": { "denom": from } },
                                "amount": quantity
                            }
                        }
                    });

            } else {
                simulationResult = await this.globals.terra.wasm.contractQuery(
                    contract,
                    {
                        "simulation": {
                            "offer_asset": {
                                "info": {
                                    "token": {
                                        "contract_addr": from
                                    }
                                },
                                "amount": quantity
                            }
                        }
                    });
            }
            const simulatedAmount = Number(simulationResult?.return_amount);
            if (simulatedAmount > this.HigestSimulatedAmount) {
                this.HigestSimulatedAmount = simulatedAmount;

                if (this.IsNative(from)) {
                    this.CW20Send = new MsgExecuteContract(
                        wallet.key.accAddress,
                        loopFactory,
                        {
                            "execute_swap_operations": {
                                "operations": [
                                    {
                                        "t_f_m_swap": {
                                            "factory_name": "loopv2",
                                            "ask_asset_info": {
                                                "token": {
                                                    "contract_addr": to
                                                }
                                            },
                                            "offer_asset_info": {
                                                "native_token": {
                                                    "denom": "uluna"
                                                }
                                            }
                                        }
                                    }
                                ],
                                "offer_amount": quantity,
                                "minimum_receive": (this.HigestSimulatedAmount / 1000000).toString()
                            }
                        },
                        { "uluna": quantity });
                } else {

                    const msg =
                        `{
                            "execute_swap_operations": {
                              "minimum_receive": "${(this.HigestSimulatedAmount / 1000000).toString()}",
                              "offer_amount": ${quantity},
                              "operations": [
                                {
                                  "t_f_m_swap": {
                                    "offer_asset_info": {
                                      "token": {
                                        "contract_addr":  ${to}
                                      }
                                    },
                                    "ask_asset_info": {
                                      "native_token": {
                                        "denom": "uluna"
                                      }
                                    },
                                    "factory_name": "loopv2"
                                  }
                                }
                              ]
                            }
                          }`;

                    let b64Msg = btoa(msg);

                    this.CW20Send = new MsgExecuteContract(
                        wallet.key.accAddress,
                        from,
                        {
                            "send": {
                                "contract": loopFactory,
                                "amount": quantity,
                                "msg": b64Msg
                            }
                        }
                    );

                }

            }

            this.FromPool = "loop";
            this.SuccessfulRoutesSimulated++;
        }
        catch (err) {
            this.logger.Error(err);
        }
        finally {
            this.logger.Debug("SimulateLoop - Function End");
        }
    }

    async SimulateAndSwap(wallet: Wallet, quantity: string, from: string, to: string) {
        try {
            this.logger.Debug("SimulateAndSwap - Function Begin");

            this.CW20Send = null;
            this.HigestSimulatedAmount = 0;
            this.SuccessfulRoutesSimulated = 0;
            this.FromPool = "";

            await this.SimulateTerraSwap(wallet, quantity, from, to);
            await this.SimulateAstroport(wallet, quantity, from, to);
            await this.SimulateLoop(wallet, quantity, from, to);

            let result: any = {};

            if (this.HigestSimulatedAmount > 0) {

                let rate = (this.HigestSimulatedAmount / Number(quantity));
                let rateInvert = (1 / (this.HigestSimulatedAmount / Number(quantity)));

                let message = "";
                let performSwap = false;
                if (rate > 0.991 && to == "uluna") {
                    message = `Bot4: Swapped [${Number(quantity) / 1000000}] CLUNA for [${Number(this.HigestSimulatedAmount) / 1000000}] LUNA at a rate of [${rate}][${rateInvert}][${this.FromPool}]`;
                    performSwap = true;
                }
                else if (rateInvert < 0.9749 && from == "uluna") {
                    message = `Bot4: Swapped [${Number(quantity) / 1000000}] LUNA for [${Number(this.HigestSimulatedAmount) / 1000000}] CLUNA at a rate of [${rateInvert}][${rate}][${this.FromPool}]`;
                    performSwap = true;
                }

                if (performSwap) {
                    let terraService = new TerraService(this.globals, this.logger);
                    let msgs: MsgExecuteContract[] = [];
                    msgs.push(this.CW20Send);
                    result.success = await terraService.ExecuteContract(wallet, msgs);
                    if (result.success == false) {
                        message = "*** ERROR *** " + message;
                    }
                    await this.globals.telegraf.telegram.sendMessage(process.env.TELEGRAM_CHANEL_ID, message);
                    this.logger.Log(message);
                } else {
                    message = `Bot4: No swapped performed, highest simulated amount [${Number(this.HigestSimulatedAmount) / 1000000}], rate is [${rate}][${rateInvert}][${this.FromPool}], found [${this.SuggestedRoutes}] routes and successfully simulated [${this.SuccessfulRoutesSimulated}]`;
                    this.logger.Log(message);
                }

                result.rate = rate;
                result.rateInvert = rateInvert;
                result.FromPool = this.FromPool;
                result.message = message;


            } else {

                result.rate = 0;
                result.rateInvert = 0;
                result.FromPool = "";
                result.message = "Error";
            }

            return result;
        }
        catch (err) {
            this.logger.Error(err);
        }
        finally {
            this.logger.Debug("SimulateAndSwap - Function End");
        }
    }
}