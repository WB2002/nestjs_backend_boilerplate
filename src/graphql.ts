/*
 * -------------------------------------------------------
 * THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)
 * -------------------------------------------------------
 */

/* tslint:disable */
/* eslint-disable */

export class CategoryFilterInput {
  name: string;
  websiteUrl?: Nullable<string>;
}

export class Category {
  id: string;
  name: string;
  description?: Nullable<string>;
}

export abstract class IQuery {
  abstract categories(): Category[] | Promise<Category[]>;

  abstract category(
    id: string,
  ): Nullable<Category> | Promise<Nullable<Category>>;

  abstract searchCategories(
    filter: CategoryFilterInput,
  ): Category[] | Promise<Category[]>;
}

type Nullable<T> = T | null;
