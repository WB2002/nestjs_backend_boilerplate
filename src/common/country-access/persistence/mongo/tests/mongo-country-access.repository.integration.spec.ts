import {
  MONGO_INTEGRATION_BEFORE_ALL_MS,
  mongoDirectConnectionUri,
  startMongoDBIntegrationContainer,
} from '@/testing/integration-containers';
import mongoose, { Connection, Model } from 'mongoose';
import {
  CountryAccessDocument,
  CountryAccessSchema,
} from '../country-access.schema';
import { MongoCountryAccessRepository } from '../mongo-country-access.repository';
import { CountryAccessConflictError } from '../../../domain';

const describeIntegration =
  process.env.SKIP_TESTCONTAINERS === 'true' ? describe.skip : describe;

describeIntegration('MongoCountryAccessRepository (integration)', () => {
  let container: Awaited<ReturnType<typeof startMongoDBIntegrationContainer>>;
  let connection: Connection;
  let model: Model<CountryAccessDocument>;
  let repository: MongoCountryAccessRepository;

  beforeAll(async () => {
    container = await startMongoDBIntegrationContainer();
    const uri = container.getConnectionString();
    await mongoose.connect(mongoDirectConnectionUri(uri));
    connection = mongoose.connection;
    model = connection.model(CountryAccessDocument.name, CountryAccessSchema);
    repository = new MongoCountryAccessRepository(model);
    await repository.ensureIndexes();
  }, MONGO_INTEGRATION_BEFORE_ALL_MS);

  afterAll(async () => {
    await mongoose.disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('ensures unique countryCode index', async () => {
    const indexes = await model.collection.indexes();
    const countryCodeIndex = indexes.find((index) =>
      Object.prototype.hasOwnProperty.call(index.key, 'countryCode'),
    );
    expect(countryCodeIndex?.unique).toBe(true);
  });

  it('inserts, reads, lists, updates, and deletes', async () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const created = await repository.upsert({
      countryCode: 'pk',
      enabled: true,
      createdAt,
      updatedAt,
    });
    expect(created.countryCode).toBe('PK');
    expect(created.enabled).toBe(true);

    expect(await repository.getByCountryCode('PK')).toEqual(created);
    expect(await repository.getAll()).toHaveLength(1);

    const updated = await repository.upsert({
      countryCode: 'PK',
      enabled: false,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
    expect(updated.enabled).toBe(false);

    await repository.delete('PK');
    expect(await repository.getByCountryCode('PK')).toBeNull();
  });

  it('rejects stale updates', async () => {
    const created = await repository.upsert({
      countryCode: 'US',
      enabled: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await repository.upsert({
      countryCode: 'US',
      enabled: false,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
    await expect(
      repository.upsert({
        countryCode: 'US',
        enabled: true,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      }),
    ).rejects.toBeInstanceOf(CountryAccessConflictError);
  });

  it('maps documents without leaking mongoose types', async () => {
    await repository.upsert({
      countryCode: 'CA',
      enabled: true,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    const row = await repository.getByCountryCode('CA');
    expect(row).toEqual({
      countryCode: 'CA',
      enabled: true,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(Object.keys(row!).sort()).toEqual([
      'countryCode',
      'createdAt',
      'enabled',
      'updatedAt',
    ]);
  });
});
