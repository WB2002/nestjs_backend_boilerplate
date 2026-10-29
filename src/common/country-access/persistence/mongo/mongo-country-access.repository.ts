import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  assertCountryCode,
  CountryAccessConflictError,
  type CountryAccessConfig,
  type CountryAccessRepository,
} from '../../domain';
import { CountryAccessDocument } from './country-access.schema';

@Injectable()
export class MongoCountryAccessRepository implements CountryAccessRepository {
  constructor(
    @InjectModel(CountryAccessDocument.name)
    private readonly model: Model<CountryAccessDocument>,
  ) {}

  async getAll(): Promise<CountryAccessConfig[]> {
    const docs = await this.model.find().sort({ countryCode: 1 }).lean().exec();
    return docs.map((doc) => this.mapDoc(doc));
  }

  async getByCountryCode(
    countryCode: string,
  ): Promise<CountryAccessConfig | null> {
    const code = assertCountryCode(countryCode);
    const doc = await this.model.findById(code).lean().exec();
    return doc ? this.mapDoc(doc) : null;
  }

  async upsert(config: CountryAccessConfig): Promise<CountryAccessConfig> {
    const code = assertCountryCode(config.countryCode);
    const existing = await this.model.findById(code).lean().exec();

    if (!existing) {
      try {
        const created = await this.model.create({
          _id: code,
          countryCode: code,
          enabled: config.enabled,
          createdAt: config.createdAt,
          updatedAt: config.updatedAt,
        });
        return this.mapDoc(created.toObject());
      } catch (err) {
        if (this.isDuplicateKey(err)) {
          throw new CountryAccessConflictError(
            `Country access ${code} was created concurrently`,
          );
        }
        throw err;
      }
    }

    const nextUpdatedAt = new Date();
    const updated = await this.model
      .findOneAndUpdate(
        {
          _id: code,
          updatedAt: config.updatedAt,
        },
        {
          $set: {
            enabled: config.enabled,
            updatedAt: nextUpdatedAt,
          },
        },
        { returnDocument: 'after', timestamps: false },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new CountryAccessConflictError(
        `Country access ${code} was modified concurrently`,
      );
    }
    return this.mapDoc(updated);
  }

  async delete(countryCode: string): Promise<void> {
    const code = assertCountryCode(countryCode);
    await this.model.deleteOne({ _id: code }).exec();
  }

  async ensureIndexes(): Promise<void> {
    await this.model.createIndexes();
  }

  private mapDoc(doc: {
    countryCode: string;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): CountryAccessConfig {
    return {
      countryCode: assertCountryCode(doc.countryCode),
      enabled: doc.enabled,
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
    };
  }

  private isDuplicateKey(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code?: number }).code === 11000
    );
  }
}
