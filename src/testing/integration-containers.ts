import {
  MongoDBContainer,
  type StartedMongoDBContainer,
} from '@testcontainers/mongodb';
import { Wait } from 'testcontainers';

const MONGO_STARTUP_MS = 180_000;

/** Mongo on CI: log + port wait is more reliable than Docker HEALTHCHECK alone. */
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

export async function startMongoDBIntegrationContainer(
  image = 'mongo:7.0',
): Promise<StartedMongoDBContainer> {
  return createMongoDBIntegrationContainer(image).start();
}
