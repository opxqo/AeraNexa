import { localApiRequest } from "./client";
import type { KnowledgeArticle, KnowledgeCategory } from "./types";

export const knowledgeApi = {
  // 获取知识库文章列表
  async fetchArticles(category?: string): Promise<KnowledgeArticle[]> {
    return localApiRequest<KnowledgeArticle[]>("client/knowledge", {
      params: { category },
    });
  },

  // 获取分类列表
  async fetchCategories(): Promise<KnowledgeCategory[]> {
    return localApiRequest<KnowledgeCategory[]>("client/knowledge/categories");
  },
};
