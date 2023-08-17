import { AddressZero } from "@ethersproject/constants";
import { bn } from "@/common/utils";

import { baseProvider } from "@/common/provider";

import { Transaction, getTransaction, saveTransactions } from "@/models/transactions";
import { TransactionReceipt } from "@ethersproject/providers";

import { TransactionTrace, TransactionTraceManyCalls } from "@/models/transaction-traces";
import { ContractAddress, saveContractAddresses } from "@/models/contract_addresses";
import { CallTrace } from "@georgeroman/evm-tx-simulator/dist/types";

import { getTransactionTraces } from "@/models/transaction-traces";
import { getSourceV1 } from "@reservoir0x/sdk/dist/utils";
import { Interface } from "@ethersproject/abi";
import { SourcesEntity } from "@/models/sources/sources-entity";
import { OrderKind, getOrderSourceByOrderId, getOrderSourceByOrderKind } from "@/orderbook/orders";
import { getRouters } from "@/utils/routers";
import { Sources } from "@/models/sources";
import { extractNestedTx } from "@/events-sync/handlers/attribution";
import { getTransactionLogs } from "@/models/transaction-logs";
import { supports_eth_getBlockReceipts } from "./supports";
import { logger } from "@/common/logger";
import { BlockWithTransactions } from "@/models/blocks";

export const fetchBlock = async (blockNumber: number, retryMax = 10) => {
  let block: BlockWithTransactions | undefined;
  let retries = 0;
  while (!block && retries < retryMax) {
    try {
      block = await baseProvider.send("eth_getBlockByNumber", [
        blockNumberToHex(blockNumber),
        true,
      ]);
    } catch (e) {
      retries++;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!block) {
    return null;
  }

  block = {
    ...block,
    number: Number(block.number),
    timestamp: Number(block.timestamp),
    gasLimit: Number(block.gasLimit),
    gasUsed: Number(block.gasUsed),
    size: Number(block.size),
    transactions: block.transactions.map((tx) => {
      return {
        ...tx,
        nonce: Number(tx.nonce),
        gas: tx?.gas ? bn(tx.gas).toString() : undefined,
        gasPrice: tx?.gasPrice ? bn(tx.gasPrice).toString() : undefined,
        maxFeePerGas: tx?.maxFeePerGas ? bn(tx.maxFeePerGas).toString() : undefined,
        maxPriorityFeePerGas: tx?.maxPriorityFeePerGas
          ? bn(tx.maxPriorityFeePerGas).toString()
          : undefined,
        value: tx.value.toString(),
        blockNumber: Number(tx.blockNumber),
        transactionIndex: Number(tx.transactionIndex),
        gasUsed: tx?.gasUsed ? bn(tx.gasUsed).toString() : undefined,
        type: tx?.type ? Number(tx.type) : 0,
      };
    }),
  };

  return block;
};

export const _saveBlockTransactions = async (
  blockData: BlockWithTransactions,
  transactionReceipts: TransactionReceipt[]
) => {
  const timerStart = Date.now();
  await saveBlockTransactions(blockData, transactionReceipts);
  const timerEnd = Date.now();
  return timerEnd - timerStart;
};

export const saveBlockTransactions = async (
  blockData: BlockWithTransactions,
  transactionReceipts: TransactionReceipt[]
) => {
  // Create transactions array to store
  const transactions = transactionReceipts.map((txReceipt) => {
    const tx = blockData.transactions.find((t) => t.hash === txReceipt.transactionHash);
    if (!tx)
      throw new Error(
        `Could not find transaction ${txReceipt.transactionHash} in block ${blockData.number}`
      );

    try {
      return {
        hash: tx.hash,
        from: tx.from,
        to: tx.to || AddressZero,
        value: tx.value.toString(),
        data: tx?.input,
        blockNumber: blockData.number,
        blockHash: blockData.hash,
        blockTimestamp: blockData.timestamp,
        gas: tx?.gas,
        gasPrice: tx?.gasPrice,
        maxFeePerGas: tx?.maxFeePerGas,
        maxPriorityFeePerGas: tx?.maxPriorityFeePerGas,
        cumulativeGasUsed: txReceipt?.cumulativeGasUsed?.toString(),
        effectiveGasPrice: txReceipt?.effectiveGasPrice?.toString(),
        contractAddress: txReceipt?.contractAddress,
        logsBloom: txReceipt.logsBloom,
        status: txReceipt.status === 1,
        transactionIndex: txReceipt.transactionIndex,
        type: tx.type,
        nonce: tx.nonce,
        gasUsed: txReceipt?.gasUsed?.toString(),
        accessList: tx.accessList,
        r: tx.r,
        s: tx.s,
        v: tx.v,
      };
    } catch (e) {
      logger.error(
        "save-block-transactions",
        `Failed to save transaction ${tx.hash} ${JSON.stringify({
          tx,
          txReceipt,
          blockData,
        })}, ${e}`
      );
      return null;
    }
  });

  // Save all transactions within the block
  await saveTransactions(transactions.filter((tx) => tx !== null) as Transaction[]);
};

export const fetchTransaction = async (hash: string) => {
  const tx = await getTransaction(hash);
  return tx;
};
export const _getTransactionTraces = async (
  _Txs: BlockWithTransactions["transactions"],
  // eslint-disable-next-line
  block: number
) => {
  const timerStart = Date.now();
  let traces: TransactionTraceManyCalls[] = [];

  try {
    traces = (await getTracesFromBlock(block)) as TransactionTraceManyCalls[];
    // // eslint-disable-next-line
    // console.log(traces);

    // traces don't have the transaction hash, so we need to add it by using the txs array we are passing in by using the index of the trace
  } catch (e) {
    logger.error(`get-transactions-traces`, `Failed to get traces from block ${block}, ${e}`);
    // traces = await getTracesFromHashes(Txs.map((tx) => tx.hash));
  }

  const timerEnd = Date.now();

  // traces = traces.filter((trace: TransactionTrace | null) => trace !== null) as TransactionTrace[];

  return {
    traces,
    getTransactionTracesTime: timerEnd - timerStart,
  };
};

export const getTransactionTraceFromRPC = async (hash: string, retryMax = 10) => {
  let trace: TransactionTrace | undefined;
  let retries = 0;
  while (!trace && retries < retryMax) {
    try {
      trace = await baseProvider.send("trace_transaction", [hash, { tracer: "callTracer" }]);
    } catch (e) {
      retries++;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  return trace;
};

export const fetchTransactionTrace = async (hash: string) => {
  const trace = await getTransactionTraces([hash]);
  return trace[0];
};
export const fetchTransactionTraces = async (hashes: string[]) => {
  const traces = await getTransactionTraces(hashes);
  return traces;
};

export const fetchTransactionLogs = async (hash: string) => {
  const tx = await getTransactionLogs(hash);
  return tx;
};

export const getTracesFromBlock = async (blockNumber: number, retryMax = 10) => {
  const traces: TransactionTraceManyCalls[] = [];
  let retries = 0;
  while (retries < retryMax) {
    try {
      const BlockTraces = (await baseProvider.send("trace_block", [
        blockNumberToHex(blockNumber),
      ])) as {
        action: {
          from: string;
          callType: string;
          gas: string;
          input: string;
          to: string;
          value: string;
        };
        blockHash: string;
        blockNumber: number;
        result: {
          gasUsed: string;
          output: string;
        };
        subtraces: number;
        traceAddress: number[];
        transactionHash: string;
        transactionPosition: number;
        type: string;
      }[];

      const txHashes = BlockTraces.map((trace) => trace.transactionHash);

      // remove duplicates
      const uniqueTxHashes = [...new Set(txHashes)];

      uniqueTxHashes.forEach((txHash) => {
        const txTraces = BlockTraces.filter((trace) => trace.transactionHash === txHash);
        const calls = txTraces.map((trace) => {
          return {
            to: trace.action.to,
            from: trace.action.from,
            type: trace.action.callType,
            input: trace.action.input,
            output: trace.result.output,
            gasUsed: trace.result.gasUsed,
            gas: trace.action.gas,
          } as CallTrace;
        });

        traces.push({
          hash: txHash,
          calls,
        });
      });

      break;

      // eslint-disable-next-line
      // console.log(traces);
    } catch (e) {
      retries++;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return traces;
};

export const getTracesFromHashes = async (txHashes: string[]): Promise<TransactionTrace[]> => {
  let traces = await Promise.all(
    txHashes.map(async (txHash) => {
      const trace = await getTransactionTraceFromRPC(txHash);
      if (!trace) {
        logger.error("sync-events-v2", `Failed to get trace for tx: ${txHash}`);
        return null;
      }

      return {
        ...trace,
        hash: txHash,
      };
    })
  );

  // remove null traces
  traces = traces.filter((trace: TransactionTrace | null) => trace !== null);

  return traces as TransactionTrace[];
};

export const _getTransactionReceiptsFromBlock = async (block: BlockWithTransactions) => {
  const timerStart = Date.now();
  let transactionReceipts;
  if (supports_eth_getBlockReceipts) {
    transactionReceipts = (await getTransactionReceiptsFromBlock(
      block.number
    )) as TransactionReceipt[];
  } else {
    transactionReceipts = await Promise.all(
      block.transactions.map((tx) => baseProvider.getTransactionReceipt(tx.hash))
    );
  }

  const timerEnd = Date.now();
  return {
    transactionReceipts,
    getTransactionReceiptsTime: timerEnd - timerStart,
  };
};

export const getTransactionReceiptsFromBlock = async (blockNumber: number, retryMax = 10) => {
  let receipts: TransactionReceipt[] | undefined;
  let retries = 0;
  while (!receipts && retries < retryMax) {
    try {
      receipts = await baseProvider.send("eth_getBlockReceipts", [blockNumberToHex(blockNumber)]);
    } catch (e) {
      retries++;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return receipts;
};

export const blockNumberToHex = (blockNumber: number) => {
  return "0x" + blockNumber.toString(16);
};

const processCall = (trace: TransactionTraceManyCalls, call: CallTrace) => {
  const processedCalls = [];
  if (
    (call.type as "CALL" | "STATICCALL" | "DELEGATECALL" | "CREATE" | "CREATE2") === "CREATE" ||
    (call.type as "CALL" | "STATICCALL" | "DELEGATECALL" | "CREATE" | "CREATE2") === "CREATE2"
  ) {
    processedCalls.push({
      address: call.to,
      deploymentTxHash: trace.hash,
      deploymentSender: call.from,
      deploymentFactory: call?.to || AddressZero,
      bytecode: call.input,
    });
  }

  if (call?.calls) {
    call.calls.forEach((c) => {
      const processedCall = processCall(trace, c);
      if (processedCall) {
        processedCalls.push(...processedCall);
      }
    });

    return processedCalls;
  }

  return processedCalls.length ? processedCalls : undefined;
};

export const processContractAddresses = async (traces: TransactionTraceManyCalls[]) => {
  let contractAddresses: ContractAddress[] = [];

  for (const trace of traces) {
    // eslint-disable-next-line
    // @ts-ignore
    trace?.calls?.forEach((call) => {
      const processedCall = processCall(trace, call);
      if (processedCall) {
        contractAddresses.push(...processedCall);
      }
    });
  }

  contractAddresses = contractAddresses.filter((ca) => ca);

  await saveContractAddresses(contractAddresses);
};

export const extractAttributionData = async (
  txHash: string,
  orderKind: OrderKind,
  options?: {
    address?: string;
    orderId?: string;
  }
) => {
  const sources = await Sources.getInstance();

  let aggregatorSource: SourcesEntity | undefined;
  let fillSource: SourcesEntity | undefined;
  let taker: string | undefined;

  let orderSource: SourcesEntity | undefined;
  if (options?.orderId) {
    // First try to get the order's source by id
    orderSource = await getOrderSourceByOrderId(options.orderId);
  }
  if (!orderSource) {
    // Default to getting the order's source by kind
    orderSource = await getOrderSourceByOrderKind(orderKind, options?.address);
  }

  // Handle internal transactions
  let tx: Pick<Transaction, "hash" | "from" | "to" | "data"> = await fetchTransaction(txHash);
  try {
    const nestedTx = await extractNestedTx(tx, true);
    if (nestedTx) {
      tx = nestedTx;
    }
  } catch {
    // Skip errors
  }

  // Properly set the taker when filling through router contracts
  const routers = await getRouters();

  let router = routers.get(tx.to);
  if (!router) {
    // Handle cases where we transfer directly to the router when filling bids
    if (tx.data.startsWith("0xb88d4fde")) {
      const iface = new Interface([
        "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
      ]);
      const result = iface.decodeFunctionData("safeTransferFrom", tx.data);
      router = routers.get(result.to.toLowerCase());
    } else if (tx.data.startsWith("0xf242432a")) {
      const iface = new Interface([
        "function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)",
      ]);
      const result = iface.decodeFunctionData("safeTransferFrom", tx.data);
      router = routers.get(result.to.toLowerCase());
    }
  }
  if (router) {
    taker = tx.from;
  }

  let source = getSourceV1(tx.data);
  if (!source) {
    const last4Bytes = "0x" + tx.data.slice(-8);
    source = sources.getByDomainHash(last4Bytes)?.domain;
  }

  // Reference: https://github.com/reservoirprotocol/core/issues/22#issuecomment-1191040945
  if (source) {
    if (source === "gem.xyz") {
      aggregatorSource = await sources.getOrInsert("gem.xyz");
    } else if (source === "blur.io") {
      aggregatorSource = await sources.getOrInsert("blur.io");
    } else if (source === "alphasharks.io") {
      aggregatorSource = await sources.getOrInsert("alphasharks.io");
    } else if (source === "magically.gg") {
      aggregatorSource = await sources.getOrInsert("magically.gg");
    }
    fillSource = await sources.getOrInsert(source);
  } else if (router) {
    fillSource = router;
  } else {
    fillSource = orderSource;
  }

  const secondSource = sources.getByDomainHash("0x" + tx.data.slice(-16, -8));
  const viaReservoir = secondSource?.domain === "reservoir.tools";
  if (viaReservoir) {
    aggregatorSource = secondSource;
  }

  return {
    orderSource,
    fillSource,
    aggregatorSource,
    taker,
  };
};
