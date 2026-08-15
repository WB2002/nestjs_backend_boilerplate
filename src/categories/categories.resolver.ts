import { Resolver, Query, Args } from '@nestjs/graphql';
import { CategoriesService } from './categories.service';
import { Public } from '@/common/decorators';

@Resolver('Category')
export class CategoriesResolver {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Public()
  @Query('categories')
  async getCategories() {
    return this.categoriesService.findAll();
  }

  @Public()
  @Query('category')
  async getCategory(@Args('id') id: string) {
    return this.categoriesService.findOneById(id);
  }
}
