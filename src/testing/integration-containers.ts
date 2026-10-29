import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import mongoose from 'mongoose';
import { Wait } from 'testcontainers';

const MONGO_PORT = 27017;
const MONGO_STARTUP_MS = 180_000;
const MONGO_PRIMARY_POLL_MS = 250;

/** Mongo on CI: log + port wait, then poll until rs0 has a writable primary. */
export function createMongoDBIntegrationContainer(
  image = 'mongo:7.0',
): MongoDBContainer {
  return new MongoDBContainer(image)
    .withWaitStrategy(
      Wait.forAll([
        Wait.forListeningPorts(),
        Wait.forLogMessage(/Waiting for connections/i),
      ]),
    )
    .withStartupTimeout(MONGO_STARTUP_MS);
}

async function waitForMongoWritablePrimary(
  host: string,
  port: number,
  timeoutMs = MONGO_STARTUP_MS,
): Promise<void> {
  const uri = `mongodb://${host}:${port}/?directConnection=true`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const connection = mongoose.createConnection(uri);
    try {
      await connection.asPromise();
      const db = connection.db;
      if (!db) {
        continue;
      }
      const hello = await db.admin().command({ hello: 1 });
      if (hello.isWritablePrimary === true) {
        return;
      }
    } catch {
      // Replica set init / election still in progress
    } finally {
      await connection.close().catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, MONGO_PRIMARY_POLL_MS));
  }

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for MongoDB primary on ${host}:${port}`,
  );
}

export async function startMongoDBIntegrationContainer(
  image = 'mongo:7.0',
): Promise<StartedMongoDBContainer> {
  const container = await createMongoDBIntegrationContainer(image).start();
  await waitForMongoWritablePrimary(
    container.getHost(),
    container.getMappedPort(MONGO_PORT),
  );
  return container;
}
