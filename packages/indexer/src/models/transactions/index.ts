import _ from "lodash";
import { idb, pgp } from "@/common/db";
import { fromBuffer, toBuffer } from "@/common/utils";

export type Transaction = {
  hash: string;
  from: string;
  to: string;
  value: string;
  data: string;
  blockNumber: number;
  blockTimestamp: number;
  gasPrice?: string;
  gasUsed?: string;
  gasFee?: string;
  cumulativeGasUsed?: string;
  contractAddress?: string;
  logsBloom?: string;
  status?: number;
  transactionIndex?: number;
};

/**
 * Store single transaction and return it
 * @param transaction
 * @return Transaction
 */
export const saveTransaction = async (transaction: Transaction) => {
  await idb.none(
    `
      INSERT INTO transactions (
        hash,
        "from",
        "to",
        value,
        data,
        block_number,
        block_timestamp,
        gas_price,
        gas_used,
        gas_fee
      ) VALUES (
        $/hash/,
        $/from/,
        $/to/,
        $/value/,
        $/data/,
        $/blockNumber/,
        $/blockTimestamp/,
        $/gasPrice/,
        $/gasUsed/,
        $/gasFee/
      )
      ON CONFLICT DO NOTHING
    `,
    {
      hash: toBuffer(transaction.hash),
      from: toBuffer(transaction.from),
      to: toBuffer(transaction.to),
      value: transaction.value,
      data: toBuffer(transaction.data),
      blockNumber: transaction.blockNumber,
      blockTimestamp: transaction.blockTimestamp,
      gasPrice: transaction.gasPrice,
      gasUsed: transaction.gasUsed,
      gasFee: transaction.gasFee,
    }
  );

  return transaction;
};

/**
 * Store batch transactions and return nothing
 * @param transactions
 */
export const saveTransactions = async (transactions: Transaction[]) => {
  if (_.isEmpty(transactions)) {
    return;
  }

  const columns = new pgp.helpers.ColumnSet(
    [
      "hash",
      "from",
      "to",
      "value",
      "data",
      "block_number",
      "block_timestamp",
      "gas_price",
      "gas_used",
      "gas_fee",
    ],
    { table: "transactions" }
  );

  const transactionsValues = _.map(transactions, (transaction) => ({
    hash: toBuffer(transaction.hash),
    from: toBuffer(transaction.from),
    to: toBuffer(transaction.to),
    value: transaction.value,
    data: toBuffer(transaction.data),
    block_number: transaction.blockNumber,
    block_timestamp: transaction.blockTimestamp,
    gas_price: transaction.gasPrice,
    gas_used: transaction.gasUsed,
    gas_fee: transaction.gasFee,
  }));

  await idb.none(
    `
      INSERT INTO transactions (
        hash,
        "from",
        "to",
        value,
        data,
        block_number,
        block_timestamp,
        gas_price,
        gas_used,
        gas_fee
      ) VALUES ${pgp.helpers.values(transactionsValues, columns)}
      ON CONFLICT DO NOTHING
    `
  );
};

/**
 * Store batch transactions and return nothing (fast version)
 * @param transactions
 */
export const saveTransactionsV2 = async (transactions: Transaction[]) => {
  const CHUNK_SIZE = 10;

  if (_.isEmpty(transactions)) {
    return;
  }

  const columns = new pgp.helpers.ColumnSet(
    [
      "hash",
      "from",
      "to",
      "value",
      "data",
      "block_number",
      "block_timestamp",
      "gas_price",
      "gas_used",
      "gas_fee",
    ],
    { table: "transactions" }
  );

  const transactionsValues = _.map(transactions, (transaction) => ({
    hash: toBuffer(transaction.hash),
    from: toBuffer(transaction.from),
    to: toBuffer(transaction.to),
    value: transaction.value,
    data: toBuffer(transaction.data),
    block_number: transaction.blockNumber,
    block_timestamp: transaction.blockTimestamp,
    gas_price: transaction.gasPrice,
    gas_used: transaction.gasUsed,
    gas_fee: transaction.gasFee,
  }));

  const chunks = _.chunk(transactionsValues, CHUNK_SIZE);

  await Promise.all(
    chunks.map((chunk) =>
      idb.none(
        `
        INSERT INTO transactions (
          hash,
          "from",
          "to",
          value,
          data,
          block_number,
          block_timestamp,
          gas_price,
          gas_used,
          gas_fee
        ) VALUES ${pgp.helpers.values(chunk, columns)}
        ON CONFLICT DO NOTHING
      `
      )
    )
  );
};

export const saveTransactionsV3 = async (transactions: Transaction[]) => {
  const CHUNK_SIZE = 10;

  if (_.isEmpty(transactions)) {
    return;
  }

  const columns = new pgp.helpers.ColumnSet(
    [
      "hash",
      "from",
      "to",
      "value",
      "data",
      "block_number",
      "block_timestamp",
      "gas_price",
      "gas_used",
      "gas_fee",
      "cumulative_gas_used",
      "contract_address",
      "logs_bloom",
      "status",
      "transaction_index",
    ],
    { table: "transactions" }
  );

  const transactionsValues = _.map(transactions, (transaction) => ({
    hash: toBuffer(transaction.hash),
    from: toBuffer(transaction.from),
    to: toBuffer(transaction.to),
    value: transaction.value,
    data: toBuffer(transaction.data),
    block_number: transaction.blockNumber,
    block_timestamp: transaction.blockTimestamp,
    gas_price: transaction.gasPrice,
    gas_used: transaction.gasUsed,
    gas_fee: transaction.gasFee,
    cumulative_gas_used: transaction.cumulativeGasUsed,
    contract_address: transaction?.contractAddress ? toBuffer(transaction.contractAddress) : null,
    logs_bloom: transaction?.logsBloom ? toBuffer(transaction.logsBloom) : null,
    status: transaction.status,
    transaction_index: transaction.transactionIndex,
  }));

  const chunks = _.chunk(transactionsValues, CHUNK_SIZE);

  await Promise.all(
    chunks.map((chunk) =>
      idb.none(
        `
        INSERT INTO transactions (
          hash,
          "from",
          "to",
          value,
          data,
          block_number,
          block_timestamp,
          gas_price,
          gas_used,
          gas_fee,
          cumulative_gas_used,
          contract_address,
          logs_bloom,
          status,
          transaction_index
        ) VALUES ${pgp.helpers.values(chunk, columns)}
        ON CONFLICT DO NOTHING
      `
      )
    )
  );
};

export const getTransaction = async (hash: string): Promise<Transaction> => {
  const result = await idb.oneOrNone(
    `
      SELECT
        transactions.from,
        transactions.to,
        transactions.value,
        transactions.data,
        transactions.gas_price,
        transactions.gas_used,
        transactions.gas_fee,
        transactions.cumulative_gas_used,
        transactions.contract_address,
        transactions.logs_bloom,
        transactions.status,
        transactions.transaction_index
        transactions.block_number,
        transactions.block_timestamp
      FROM transactions
      WHERE transactions.hash = $/hash/
    `,
    { hash: toBuffer(hash) }
  );

  return {
    hash,
    blockNumber: result.block_number,
    from: fromBuffer(result.from),
    to: fromBuffer(result.to),
    value: result.value,
    data: fromBuffer(result.data),
    blockNumber: result.block_number,
    blockTimestamp: result.block_timestamp,
    gasPrice: result.gas_price,
    gasUsed: result.gas_used,
    gasFee: result.gas_fee,
    cumulativeGasUsed: result.cumulative_gas_used,
    status: result.status,
    transactionIndex: result.transaction_index,
  };
};
