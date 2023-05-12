/* eslint-disable @typescript-eslint/no-explicit-any */

import { Job, Queue, QueueScheduler, Worker } from "bullmq";
import { randomUUID } from "crypto";

import { logger } from "@/common/logger";
import { redis, redlock } from "@/common/redis";
import { ridb } from "@/common/db";
import { config } from "@/config/index";

import { AskActivityBuilder } from "@/elasticsearch/indexes/activities/ask";
import * as ActivitiesIndex from "@/elasticsearch/indexes/activities";

const QUEUE_NAME = "backfill-ask-activities-elasticsearch";

export const queue = new Queue(QUEUE_NAME, {
  connection: redis.duplicate(),
  defaultJobOptions: {
    attempts: 10,
    removeOnComplete: 1000,
    removeOnFail: 10000,
  },
});

new QueueScheduler(QUEUE_NAME, { connection: redis.duplicate() });

// BACKGROUND WORKER ONLY
if (config.doBackgroundWork && config.doElasticsearchWork) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const cursor = job.data.cursor as CursorInfo;

      const limit = Number((await redis.get(`${QUEUE_NAME}-limit`)) || 1);

      try {
        let continuationFilter = "";

        if (cursor) {
          continuationFilter = `AND (updated_at, id) > (to_timestamp($/updatedAt/), $/id/)`;
        }

        const askActivityBuilder = new AskActivityBuilder();

        const query = `
            ${askActivityBuilder.buildBaseQuery()}
            WHERE side = 'sell'
            ${continuationFilter}
            ORDER BY updated_at, id
            LIMIT $/limit/;
          `;

        const results = await ridb.manyOrNone(query, {
          id: cursor?.id,
          updatedAt: cursor?.updatedAt,
          limit,
        });

        if (results.length) {
          const activities = [];

          for (const result of results) {
            const buildInfo = askActivityBuilder.formatData(result);
            const activity = askActivityBuilder.buildDocument(buildInfo);

            activities.push(activity);
          }

          await ActivitiesIndex.save(activities);

          logger.info(QUEUE_NAME, `Processed ${results.length} activities.`);

          const lastResult = results[results.length - 1];

          await addToQueue({
            updatedAt: lastResult.updated_ts,
            id: lastResult.order_id,
          });
        }
      } catch (error) {
        logger.error(
          QUEUE_NAME,
          `Process error.  limit=${limit}, cursor=${JSON.stringify(cursor)}, error=${JSON.stringify(
            error
          )}`
        );
      }
    },
    { connection: redis.duplicate(), concurrency: 1 }
  );

  worker.on("error", (error) => {
    logger.error(QUEUE_NAME, `Worker errored: ${error}`);
  });

  redlock
    .acquire([`${QUEUE_NAME}-lock-v7`], 60 * 60 * 24 * 30 * 1000)
    .then(async () => {
      await addToQueue();
    })
    .catch(() => {
      // Skip on any errors
    });
}

export const addToQueue = async (cursor?: CursorInfo) => {
  await queue.add(randomUUID(), { cursor }, { delay: 1000 });
};

export interface CursorInfo {
  updatedAt: string;
  id: string;
}
