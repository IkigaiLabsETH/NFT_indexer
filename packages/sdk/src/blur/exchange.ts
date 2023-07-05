import { Interface, Result } from "@ethersproject/abi";
import { Provider } from "@ethersproject/abstract-provider";
import { Signer } from "@ethersproject/abstract-signer";
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { AddressZero, HashZero } from "@ethersproject/constants";
import { Contract, ContractTransaction } from "@ethersproject/contracts";

import * as CommonAddresses from "../common/addresses";
import * as RouterAddresses from "../router/v6/addresses";
import * as SeaportBase from "../seaport-base";
import * as SeaportV15 from "../seaport-v1.5";
import { TxData, getCurrentTimestamp, getRandomBytes } from "../utils";
import * as Addresses from "./addresses";
import { Order } from "./order";
import * as Types from "./types";

import SeaportExchangeAbi from "../seaport-v1.5/abis/Exchange.json";
import ExchangeAbi from "./abis/Exchange.json";

export class Exchange {
  public chainId: number;
  public contract: Contract;

  constructor(chainId: number) {
    this.chainId = chainId;
    this.contract = new Contract(Addresses.Exchange[this.chainId], ExchangeAbi);
  }

  // --- Cancel order ---

  public async cancelOrder(maker: Signer, order: Order): Promise<ContractTransaction> {
    const tx = this.cancelOrderTx(await maker.getAddress(), order);
    return maker.sendTransaction(tx);
  }

  public cancelOrderTx(maker: string, order: Order): TxData {
    const data: string = this.contract.interface.encodeFunctionData("cancelOrder", [order.params]);
    return {
      from: maker,
      to: this.contract.address,
      data,
    };
  }

  // --- Get nonce ---

  public async getNonce(provider: Provider, user: string): Promise<BigNumber> {
    return this.contract.connect(provider).nonces(user);
  }

  // --- Increase nonce ---

  public async incrementHashNonce(maker: Signer): Promise<ContractTransaction> {
    const tx = this.incrementHashNonceTx(await maker.getAddress());
    return maker.sendTransaction(tx);
  }

  public incrementHashNonceTx(maker: string): TxData {
    const data: string = this.contract.interface.encodeFunctionData("incrementNonce", []);
    return {
      from: maker,
      to: this.contract.address,
      data,
    };
  }

  // --- Generate fee orders ---

  public async generateBlurFeeTradeDetails(taker: string, amount: BigNumberish, recipient: string) {
    const order = new SeaportV15.Order(this.chainId, {
      // To avoid format checking
      kind: "single-token",
      // We need an EIP1271-compliant contract that always returns success
      offerer: RouterAddresses.PaymentProcessorModule[this.chainId],
      zone: AddressZero,
      offer: [],
      consideration: [
        {
          itemType: SeaportBase.Types.ItemType.NATIVE,
          token: CommonAddresses.Eth[this.chainId],
          identifierOrCriteria: "0",
          startAmount: amount.toString(),
          endAmount: amount.toString(),
          recipient,
        },
      ],
      orderType: SeaportBase.Types.OrderType.FULL_OPEN,
      startTime: getCurrentTimestamp() - 60,
      endTime: getCurrentTimestamp() + 10 * 60,
      zoneHash: HashZero,
      salt: getRandomBytes(10).toString(),
      conduitKey: HashZero,
      counter: "0",
    });

    return {
      marketId: 10,
      value: amount.toString(),
      tradeData: new Interface(["function execute(bytes data)"]).encodeFunctionData("execute", [
        new Interface(SeaportExchangeAbi).encodeFunctionData("fulfillAvailableAdvancedOrders", [
          [
            {
              parameters: {
                ...order.params,
                totalOriginalConsiderationItems: order.params.consideration.length,
              },
              numerator: 1,
              denominator: 1,
              signature: "0x",
              extraData: "0x",
            },
          ],
          [],
          [],
          [
            [
              {
                orderIndex: 0,
                itemIndex: 0,
              },
            ],
          ],
          HashZero,
          taker,
          1,
        ]),
      ]),
    };
  }

  public async generateBlurFeeExecutionInputs(
    provider: Provider,
    taker: string,
    makerSide: Types.TradeDirection,
    amount: BigNumberish,
    recipient: string
  ) {
    const sellOrder = new Order(this.chainId, {
      trader: taker,
      side: Types.TradeDirection.SELL,
      matchingPolicy: Addresses.StandardPolicyERC721[this.chainId],
      collection: Addresses.BlurTransferHelper[this.chainId],
      tokenId: "0",
      amount: "1",
      paymentToken:
        makerSide === Types.TradeDirection.SELL
          ? CommonAddresses.Eth[this.chainId]
          : Addresses.Beth[this.chainId],
      price: amount.toString(),
      nonce: (await this.getNonce(provider, taker)).toString(),
      listingTime: String(getCurrentTimestamp() - 60),
      expirationTime: String(getCurrentTimestamp() + 10 * 60),
      fees: [
        {
          rate: 10000,
          recipient,
        },
      ],
      salt: "0",
      extraParams: "0x",
      extraSignature: "0x",
      signatureVersion: Types.SignatureVersion.SINGLE,
    });

    const buyOrder = new Order(this.chainId, {
      trader: taker,
      side: Types.TradeDirection.BUY,
      matchingPolicy: Addresses.StandardPolicyERC721[this.chainId],
      collection: Addresses.BlurTransferHelper[this.chainId],
      tokenId: "0",
      amount: "1",
      paymentToken:
        makerSide === Types.TradeDirection.SELL
          ? CommonAddresses.Eth[this.chainId]
          : Addresses.Beth[this.chainId],
      price: amount.toString(),
      nonce: (await this.getNonce(provider, taker)).toString(),
      listingTime: String(getCurrentTimestamp() - 60),
      expirationTime: String(getCurrentTimestamp() + 10 * 60),
      fees: [],
      salt: "0",
      extraParams: "0x",
      extraSignature: "0x",
      signatureVersion: Types.SignatureVersion.SINGLE,
    });

    return {
      sell: {
        order: sellOrder.params,
        v: 0,
        r: HashZero,
        s: HashZero,
        extraSignature: "0x",
        signatureVersion: sellOrder.params.signatureVersion,
        blockNumber: 0,
      },
      buy: {
        order: buyOrder.params,
        v: 0,
        r: HashZero,
        s: HashZero,
        extraSignature: "0x",
        signatureVersion: sellOrder.params.signatureVersion,
        blockNumber: 0,
      },
    };
  }

  // --- Get bids from calldata ---

  private nonceCache: { [user: string]: string } = {};
  public async getMatchedOrdersFromCalldata(
    provider: Provider,
    calldata: string
  ): Promise<{ buy: Order; sell: Order }[]> {
    const getNonce = async (user: string) => {
      if (!this.nonceCache[user]) {
        this.nonceCache[user] = (await this.getNonce(provider, user)).toString();
      }
      return this.nonceCache[user];
    };

    const buildOrder = async (values: Result, retrieveNonce = false) =>
      new Order(this.chainId, {
        // Force the kind since it's irrelevant
        kind: "erc721-single-token",
        trader: values.order.trader,
        side: values.order.side,
        matchingPolicy: values.order.matchingPolicy,
        collection: values.order.collection,
        tokenId: values.order.tokenId,
        amount: values.order.amount,
        paymentToken: values.order.paymentToken,
        price: values.order.price,
        listingTime: values.order.listingTime,
        expirationTime: values.order.expirationTime,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fees: values.order.fees.map((f: any) => ({
          rate: f.rate,
          recipient: f.recipient,
        })),
        salt: values.order.salt,
        nonce: retrieveNonce ? await getNonce(values.order.trader) : "0",
        extraParams: values.order.extraParams,
        extraSignature: values.extraSignature,
        signatureVersion: values.signatureVersion,
      });

    const bytes4 = calldata.slice(0, 10);
    switch (bytes4) {
      // `execute`
      case "0x9a1fc3a7": {
        const result = this.contract.interface.decodeFunctionData("execute", calldata);
        return [
          {
            buy: await buildOrder(result.buy, true),
            sell: await buildOrder(result.sell),
          },
        ];
      }

      // `bulkExecute`
      case "0xb3be57f8": {
        const result = this.contract.interface.decodeFunctionData("bulkExecute", calldata);
        return Promise.all(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          result.executions.map(async (e: any) => ({
            buy: await buildOrder(e.buy, true),
            sell: await buildOrder(e.sell),
          }))
        );
      }

      default: {
        return [];
      }
    }
  }
}
