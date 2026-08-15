import { Injectable } from '@nestjs/common';

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
}
