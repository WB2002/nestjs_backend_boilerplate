import { isValidFeatureFlagShape } from './feature-flag.evaluator';
import { IFeatureFlag, IFeatureFlagEvent } from './types';
import { FeatureFlagEventType } from './types';

/**
 * In-memory flag snapshot. All replacements are atomic (assign a new Map).
 */
export class FeatureFlagCache {
  private flags: Map<string, IFeatureFlag> = new Map();

  getSnapshot(): ReadonlyMap<string, IFeatureFlag> {
    return this.flags;
  }

  get(key: string): IFeatureFlag | undefined {
    return this.flags.get(key);
  }

  size(): number {
    return this.flags.size;
  }

  /**
   * Replace the entire local snapshot. Invalid entries are skipped.
   */
  replaceAll(flags: Iterable<IFeatureFlag>): number {
    const next = new Map<string, IFeatureFlag>();
    let skipped = 0;
    for (const flag of flags) {
      if (!isValidFeatureFlagShape(flag)) {
        skipped += 1;
        continue;
      }
      next.set(flag.key, flag);
    }
    this.flags = next;
    return skipped;
  }

  /**
   * Apply a single updated flag if newer than local version.
   * Returns true when the local map changed.
   */
  applyUpdate(flag: IFeatureFlag): boolean {
    if (!isValidFeatureFlagShape(flag)) {
      return false;
    }
    const local = this.flags.get(flag.key);
    if (local && flag.version <= local.version) {
      return false;
    }
    const next = new Map(this.flags);
    next.set(flag.key, flag);
    this.flags = next;
    return true;
  }

  /**
   * Apply a delete event if version is newer than local.
   */
  applyDelete(key: string, version: number): boolean {
    const local = this.flags.get(key);
    if (!local) {
      return false;
    }
    if (version <= local.version) {
      return false;
    }
    const next = new Map(this.flags);
    next.delete(key);
    this.flags = next;
    return true;
  }

  /**
   * Handle a Pub/Sub event after the flag payload (if any) is loaded.
   */
  applyEvent(
    event: IFeatureFlagEvent,
    environment: string,
    flag: IFeatureFlag | null,
  ): boolean {
    if (event.environment !== environment) {
      return false;
    }
    if (event.event === FeatureFlagEventType.FLAG_DELETED) {
      return this.applyDelete(event.key, event.version);
    }
    if (event.event === FeatureFlagEventType.FLAG_UPDATED) {
      if (!flag) {
        return false;
      }
      if (flag.version < event.version) {
        return false;
      }
      return this.applyUpdate(flag);
    }
    return false;
  }
}
