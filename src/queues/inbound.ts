import { Queue, Worker, type ConnectionOptions } from "bullmq";

export const INBOUND_QUEUE = "inbound";

const jobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 1000 },
  removeOnComplete: true,
  removeOnFail: true,
};

export function createInboundQueue(connection: ConnectionOptions): Queue<{ envelope: unknown }> {
  return new Queue(INBOUND_QUEUE, { connection, defaultJobOptions: jobOptions });
}

export function startInboundWorker(
  connection: ConnectionOptions,
  processor: (envelope: unknown, attempt: { attempt: number; maxAttempts: number }) => Promise<void>,
): Worker {
  return new Worker(
    INBOUND_QUEUE,
    async (job) => {
      await processor(job.data.envelope, {
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
      });
    },
    { connection, concurrency: 1 },
  );
}
