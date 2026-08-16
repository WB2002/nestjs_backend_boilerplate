/*
 * -------------------------------------------------------
 * THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)
 * -------------------------------------------------------
 */

/* tslint:disable */
/* eslint-disable */

export class Category {
  declare id: string;
  declare name: string;
  description?: Nullable<string>;
}

export abstract class IQuery {
  abstract categories(): Category[] | Promise<Category[]>;

  abstract category(
    id: string,
  ): Nullable<Category> | Promise<Nullable<Category>>;
}

type Nullable<T> = T | null;
