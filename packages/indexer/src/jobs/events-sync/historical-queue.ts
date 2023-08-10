import { logger } from "@/common/logger";
import { syncEvents } from "@/events-sync/index";
import { AbstractRabbitMqJobHandler, BackoffStrategy } from "@/jobs/abstract-rabbit-mq-job-handler";

import { checkSupports } from "@/events-sync/supports";
import { redis } from "@/common/redis";

export type EventsSyncHistoricalJobPayload = {
  block: number;
  syncEventsToMainDB?: boolean;
  backfillId?: string;
};

export class EventsSyncHistoricalJob extends AbstractRabbitMqJobHandler {
  queueName = "events-sync-historical";
  maxRetries = 30;
  concurrency = 150;
  consumerTimeout = 60 * 3000;
  backoff = {
    type: "fixed",
    delay: 1000,
  } as BackoffStrategy;

  constructor() {
    super();
    checkSupports();
  }
  protected async process(payload: EventsSyncHistoricalJobPayload) {
    try {
      const { block, syncEventsToMainDB } = payload;

      await syncEvents(block, syncEventsToMainDB);

      if (payload.backfillId) {
        const latestBlock = Number(await redis.get(`backfill:latestBlock:${payload.backfillId}`));
        const maxBlock = Number(await redis.get(`backfill:maxBlock:${payload.backfillId}`));
        if (block > latestBlock && block < maxBlock) {
          await redis.set(`backfill:latestBlock:${payload.backfillId}`, `${block}`);
          await this.addToQueue({
            block: block + 1,
            syncEventsToMainDB,
            backfillId: payload.backfillId,
          });
        }
      }
    } catch (error) {
      logger.warn(this.queueName, `Events historical syncing failed: ${error}`);
      throw error;
    }
  }

  public async addToQueue(params: EventsSyncHistoricalJobPayload, delay = 0) {
    await this.send({ payload: params, jobId: `${params.block}` }, delay);
  }
}

export const eventsSyncHistoricalJob = new EventsSyncHistoricalJob();
