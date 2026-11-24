/*
 * -------------------------------------------------------
 * THIS FILE WAS AUTOMATICALLY GENERATED (DO NOT MODIFY)
 * -------------------------------------------------------
 */

/* tslint:disable */
/* eslint-disable */

export interface CategoryFilterInput {
  name: string;
  websiteUrl?: Nullable<string>;
}

export interface Category {
  id: string;
  name: string;
  description?: Nullable<string>;
}

export interface IQuery {
  categories(): Category[] | Promise<Category[]>;
  category(id: string): Nullable<Category> | Promise<Nullable<Category>>;
  searchCategories(
    filter: CategoryFilterInput,
  ): Category[] | Promise<Category[]>;
}

type Nullable<T> = T | null;
