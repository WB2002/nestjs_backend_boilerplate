import { Injectable } from '@nestjs/common';
import type { CategoryFilterInput } from './dto/category-filter.input';

@Injectable()
export class CategoriesService {
  private categories = [
    { id: '1', name: 'Electronics', description: 'Gadgets and devices' },
    { id: '2', name: 'Books', description: 'All kinds of books' },
    { id: '3', name: 'Clothing', description: 'Fashionable clothes' },
  ];

  findAll() {
    return this.categories;
  }

  findOneById(id: string) {
    return this.categories.find((category) => category.id === id);
  }

  search(filter: CategoryFilterInput) {
    const needle = filter.name.trim().toLowerCase();
    return this.categories.filter((category) =>
      category.name.toLowerCase().includes(needle),
    );
  }
}
