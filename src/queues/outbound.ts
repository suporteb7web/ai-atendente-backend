import { Queue, Worker, type ConnectionOptions } from "bullmq";

export const OUTBOUND_QUEUE = "outbound";

const jobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 1000 },
  removeOnComplete: true,
  removeOnFail: true,
};

export function createOutboundQueue(connection: ConnectionOptions): Queue<{ messageId: string }> {
  return new Queue(OUTBOUND_QUEUE, { connection, defaultJobOptions: jobOptions });
}

export function startOutboundWorker(
  connection: ConnectionOptions,
  processor: (messageId: string, attempt: { attempt: number; maxAttempts: number }) => Promise<void>,
): Worker {
  return new Worker(
    OUTBOUND_QUEUE,
    async (job) => {
      await processor(job.data.messageId, {
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
      });
    },
    { connection, concurrency: 2 },
  );
}
